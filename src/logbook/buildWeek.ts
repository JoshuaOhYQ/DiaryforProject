/** Collect one week of work into the sections of a log book page. Pure, so it is easy to test. */
import type { Entry, Feature, ISODate, Member, Project, Task } from '../types.ts';
import type { ProjectData } from '../data/select.ts';
import { weekNoteId } from '../data/factories.ts';
import { addDays, diffDays, eachDay, formatRange, isoWeekNumber, isWithin, startOfWeek } from '../lib/dates.ts';
import { actualsFor, slippage, type Actuals, type Slippage } from '../gantt/ganttMath.ts';
import { draftNarrative } from './narrative.ts';

export interface MemberWeek {
  member: Member;
  hours: number;
  entries: Entry[];
  features: { feature: Feature | null; hours: number }[];
  /** Saved narrative (may be empty). */
  narrative: string;
  /** Template paragraph built from the entries. */
  draft: string;
}

export interface LogbookWeek {
  project: Project;
  weekStart: ISODate;
  weekEnd: ISODate;
  weekLabel: string;
  rangeLabel: string;
  /** Set when the page is for one member only. */
  member: Member | null;
  entries: Entry[];
  days: ISODate[];
  hoursTable: { member: Member; perDay: number[]; total: number }[];
  dayTotals: number[];
  totalHours: number;
  members: MemberWeek[];
  completed: { task: Task; actual: Actuals; slip: Slippage }[];
  milestones: { task: Task; reached: boolean }[];
  issues: Entry[];
  nextSteps: { member: Member; entry: Entry }[];
  plannedNext: Task[];
}

export function weekNumberLabel(project: Project, weekStart: ISODate): string {
  if (project.startDate) {
    const n = Math.floor(diffDays(startOfWeek(project.startDate, project.weekStartsOn), weekStart) / 7) + 1;
    return n >= 1 ? `Week ${n}` : `Before week 1`;
  }
  return `Week ${isoWeekNumber(weekStart)}`;
}

const round = (n: number) => Math.round(n * 100) / 100;

export function buildWeek(data: ProjectData, anyDayInWeek: ISODate, memberId: string | null, today: ISODate): LogbookWeek {
  const { project } = data;
  const weekStart = startOfWeek(anyDayInWeek, project.weekStartsOn);
  const weekEnd = addDays(weekStart, 6);
  const days = eachDay(weekStart, weekEnd);
  const member = memberId ? (data.memberById.get(memberId) ?? null) : null;
  const rangeLabel = formatRange(weekStart, weekEnd);

  const entries = data.entries
    .filter((e) => isWithin(e.date, weekStart, weekEnd) && (!member || e.authorId === member.id))
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));

  // Members shown: the chosen one, or everyone active plus anyone archived who logged this week.
  const people = member ? [member] : data.members.filter((m) => !m.archived || entries.some((e) => e.authorId === m.id));

  const hoursTable = people.map((m) => {
    const perDay = days.map((d) => round(entries.filter((e) => e.authorId === m.id && e.date === d).reduce((s, e) => s + e.hours, 0)));
    return { member: m, perDay, total: round(perDay.reduce((s, h) => s + h, 0)) };
  });
  const dayTotals = days.map((_, i) => round(hoursTable.reduce((s, r) => s + r.perDay[i], 0)));

  const featureName = (id: string | null) => (id ? (data.featureById.get(id)?.name ?? null) : null);
  const members: MemberWeek[] = people.map((m) => {
    const mine = entries.filter((e) => e.authorId === m.id);
    const byFeature = new Map<string | null, number>();
    for (const e of mine) byFeature.set(e.featureId, (byFeature.get(e.featureId) ?? 0) + e.hours);
    const note = data.weekNotes.find((n) => n.id === weekNoteId(project.id, weekStart, m.id));
    return {
      member: m,
      hours: round(mine.reduce((s, e) => s + e.hours, 0)),
      entries: mine,
      features: [...byFeature.entries()]
        .map(([id, hours]) => ({ feature: id ? (data.featureById.get(id) ?? null) : null, hours: round(hours) }))
        .sort((a, b) => b.hours - a.hours),
      narrative: note?.narrative ?? '',
      draft: draftNarrative({ name: m.name, range: rangeLabel, entries: mine, featureName }),
    };
  });

  const relevant = (t: Task) => !member || t.assigneeIds.includes(member.id) || entries.some((e) => e.taskId === t.id);

  const completed = data.tasks
    .filter((t) => !t.milestone && t.progress >= 100 && relevant(t))
    .map((task) => ({ task, actual: actualsFor(task.id, data.entries) }))
    .filter(({ task, actual }) => isWithin(actual.end ?? task.end, weekStart, weekEnd))
    .map(({ task, actual }) => ({ task, actual, slip: slippage(task, actual, today) }));

  const milestones = data.tasks
    .filter((t) => t.milestone && isWithin(t.start, weekStart, weekEnd) && relevant(t))
    .map((task) => ({ task, reached: task.progress >= 100 }));

  const nextStart = addDays(weekEnd, 1);
  const nextEnd = addDays(nextStart, 6);
  const plannedNext = data.tasks.filter(
    (t) => t.progress < 100 && t.start <= nextEnd && t.end >= nextStart && (!member || t.assigneeIds.includes(member.id)),
  );

  // Each member's most recent "next steps" this week.
  const nextSteps = people
    .map((m) => {
      const entry = [...entries].reverse().find((e) => e.authorId === m.id && e.next.trim());
      return entry ? { member: m, entry } : null;
    })
    .filter((x): x is { member: Member; entry: Entry } => !!x);

  return {
    project,
    weekStart,
    weekEnd,
    weekLabel: weekNumberLabel(project, weekStart),
    rangeLabel,
    member,
    entries,
    days,
    hoursTable,
    dayTotals,
    totalHours: round(entries.reduce((s, e) => s + e.hours, 0)),
    members,
    completed,
    milestones,
    issues: entries.filter((e) => e.problems.trim()),
    nextSteps,
    plannedNext,
  };
}

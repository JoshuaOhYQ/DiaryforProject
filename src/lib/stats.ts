/** Totals over log entries: per member, per feature, and the member × feature matrix. */
import type { Entry, ISODate } from '../types.ts';
import { addDays, diffDays, startOfWeek } from './dates.ts';

export interface Tally {
  hours: number;
  count: number;
  /** Most recent entry date, if any. */
  last: ISODate | null;
  entries: Entry[];
}

const emptyTally = (): Tally => ({ hours: 0, count: 0, last: null, entries: [] });

function add(t: Tally, e: Entry) {
  t.hours = Math.round((t.hours + e.hours) * 100) / 100;
  t.count++;
  if (!t.last || e.date > t.last) t.last = e.date;
  t.entries.push(e);
}

export function tallyBy(entries: Entry[], key: (e: Entry) => string): Map<string, Tally> {
  const out = new Map<string, Tally>();
  for (const e of entries) {
    const k = key(e);
    let t = out.get(k);
    if (!t) out.set(k, (t = emptyTally()));
    add(t, e);
  }
  return out;
}

export const NO_FEATURE = '__none';

export interface Matrix {
  cell(memberId: string, featureId: string): Tally;
  byMember: Map<string, Tally>;
  byFeature: Map<string, Tally>;
  total: Tally;
  /** Largest cell, for shading. */
  maxHours: number;
}

/** The start dates of the `count` weeks ending with the week containing `today`. */
export function recentWeeks(today: ISODate, count: number, weekStartsOn: 0 | 1): ISODate[] {
  const current = startOfWeek(today, weekStartsOn);
  return Array.from({ length: count }, (_, i) => addDays(current, (i - count + 1) * 7));
}

export interface WeekCell {
  weekStart: ISODate;
  hours: number;
  count: number;
}

/** Hours and entry counts per member for each week. Every member gets a value for every week. */
export function weeklyByMember(entries: Entry[], memberIds: string[], weeks: ISODate[], weekStartsOn: 0 | 1): Map<string, WeekCell[]> {
  const index = new Map(weeks.map((w, i) => [w, i]));
  const out = new Map(memberIds.map((id) => [id, weeks.map((weekStart) => ({ weekStart, hours: 0, count: 0 }))]));
  for (const e of entries) {
    const i = index.get(startOfWeek(e.date, weekStartsOn));
    const row = out.get(e.authorId);
    if (i === undefined || !row) continue;
    row[i].hours = Math.round((row[i].hours + e.hours) * 100) / 100;
    row[i].count++;
  }
  return out;
}

/** Days since each member's most recent entry (null if they have never logged). */
export function daysSinceLastEntry(entries: Entry[], memberIds: string[], today: ISODate): Map<string, number | null> {
  const last = tallyBy(entries, (e) => e.authorId);
  return new Map(memberIds.map((id) => [id, last.get(id)?.last ? diffDays(last.get(id)!.last!, today) : null]));
}

/** Who did what: hours and entry counts for every member × feature pair. */
export function buildMatrix(entries: Entry[]): Matrix {
  const cells = tallyBy(entries, (e) => `${e.authorId}|${e.featureId ?? NO_FEATURE}`);
  const total = emptyTally();
  for (const e of entries) add(total, e);
  return {
    cell: (m, f) => cells.get(`${m}|${f}`) ?? emptyTally(),
    byMember: tallyBy(entries, (e) => e.authorId),
    byFeature: tallyBy(entries, (e) => e.featureId ?? NO_FEATURE),
    total,
    maxHours: Math.max(0, ...[...cells.values()].map((t) => t.hours)),
  };
}

/**
 * Gantt chart date maths: moving tasks, finish-to-start dependencies, and planned vs actual.
 *
 * Planned dates are what you put on the chart. Actual dates come from the log entries linked
 * to a task (first and last entry), so slippage shows up without anyone updating the plan.
 */
import type { Entry, ISODate, Task } from '../types.ts';
import { addDays, diffDays, maxDate } from '../lib/dates.ts';

/** Number of calendar days a task covers, counting both ends (a milestone is 1). */
export function taskDays(t: Task): number {
  return diffDays(t.start, t.end) + 1;
}

export function moveTask(t: Task, days: number): Task {
  if (!days) return t;
  return { ...t, start: addDays(t.start, days), end: addDays(t.end, days) };
}

/** Drag one edge. A task can never end before it starts; a milestone just moves. */
export function resizeTask(t: Task, edge: 'start' | 'end', days: number): Task {
  if (t.milestone) return moveTask(t, days);
  if (edge === 'start') {
    const start = addDays(t.start, days);
    return { ...t, start: start > t.end ? t.end : start };
  }
  const end = addDays(t.end, days);
  return { ...t, end: end < t.start ? t.start : end };
}

/**
 * The earliest date a task may start once `pred` is finished.
 * Normal tasks start the day after; next to a milestone the same day is fine.
 */
export function earliestStartAfter(pred: Task, succ: Task): ISODate {
  return pred.milestone || succ.milestone ? pred.end : addDays(pred.end, 1);
}

export function earliestStart(task: Task, byId: Map<string, Task>): ISODate | null {
  let best: ISODate | null = null;
  for (const id of task.dependsOn) {
    const pred = byId.get(id);
    if (pred) best = maxDate(best, earliestStartAfter(pred, task));
  }
  return best;
}

/** Would making `taskId` depend on `dependsOnId` create a loop? */
export function wouldCreateCycle(tasks: Task[], taskId: string, dependsOnId: string): boolean {
  if (taskId === dependsOnId) return true;
  const byId = new Map(tasks.map((t) => [t.id, t]));
  // Is taskId already (directly or indirectly) a prerequisite of dependsOnId?
  const stack = [dependsOnId];
  const seen = new Set<string>();
  while (stack.length) {
    const id = stack.pop()!;
    if (id === taskId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(byId.get(id)?.dependsOn ?? []));
  }
  return false;
}

export interface DependencyConflict {
  taskId: string;
  dependsOnId: string;
  /** How many days too early the task starts. */
  days: number;
}

/** Tasks that start before something they depend on has finished. */
export function dependencyConflicts(tasks: Task[]): DependencyConflict[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const out: DependencyConflict[] = [];
  for (const t of tasks) {
    for (const id of t.dependsOn) {
      const pred = byId.get(id);
      if (!pred) continue;
      const days = diffDays(t.start, earliestStartAfter(pred, t));
      if (days > 0) out.push({ taskId: t.id, dependsOnId: id, days });
    }
  }
  return out;
}

/**
 * After `changed` tasks moved, push any dependent tasks later so they still start after their
 * prerequisites, keeping their length. Tasks are never pulled earlier. Returns only tasks that moved.
 */
export function cascadeDependents(tasks: Task[], changed: Task[]): Task[] {
  const current = new Map(tasks.map((t) => [t.id, t]));
  for (const t of changed) current.set(t.id, t);
  const dependents = new Map<string, string[]>();
  for (const t of current.values()) for (const d of t.dependsOn) dependents.set(d, [...(dependents.get(d) ?? []), t.id]);

  const moved = new Map<string, Task>();
  const queue = changed.map((t) => t.id);
  let guard = current.size * current.size + 10; // stops runaway loops if data somehow has a cycle
  while (queue.length && guard-- > 0) {
    const id = queue.shift()!;
    for (const depId of dependents.get(id) ?? []) {
      const t = current.get(depId)!;
      const min = earliestStart(t, current);
      if (min && t.start < min) {
        const next = moveTask(t, diffDays(t.start, min));
        current.set(depId, next);
        moved.set(depId, next);
        queue.push(depId);
      }
    }
  }
  return [...moved.values()];
}

// ---- planned vs actual ---------------------------------------------------------

export interface Actuals {
  /** First and last log entry linked to the task. */
  start: ISODate | null;
  end: ISODate | null;
  hours: number;
  entryCount: number;
}

export function actualsFor(taskId: string, entries: Entry[]): Actuals {
  let start: ISODate | null = null;
  let end: ISODate | null = null;
  let hours = 0;
  let entryCount = 0;
  for (const e of entries) {
    if (e.taskId !== taskId) continue;
    if (!start || e.date < start) start = e.date;
    if (!end || e.date > end) end = e.date;
    hours += e.hours;
    entryCount++;
  }
  return { start, end, hours: Math.round(hours * 100) / 100, entryCount };
}

export function actualsByTask(tasks: Task[], entries: Entry[]): Map<string, Actuals> {
  return new Map(tasks.map((t) => [t.id, actualsFor(t.id, entries)]));
}

export type ScheduleStatus = 'upcoming' | 'late-start' | 'in-progress' | 'overdue' | 'done' | 'done-late' | 'done-early';

export interface Slippage {
  status: ScheduleStatus;
  /** Days the actual start was after the planned start (negative = early). Null if not started and not yet due. */
  startSlip: number | null;
  /** Days past the planned end: finished late, or still open after the end date. */
  endSlip: number;
  label: string;
}

const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`;

export function slippage(task: Task, actual: Actuals, today: ISODate): Slippage {
  const done = task.progress >= 100;
  let startSlip: number | null = null;
  if (actual.start) startSlip = diffDays(task.start, actual.start);
  else if (!done && today > task.start) startSlip = diffDays(task.start, today);

  if (done) {
    const finished = actual.end ?? task.end;
    const endSlip = diffDays(task.end, finished);
    if (endSlip > 0) return { status: 'done-late', startSlip, endSlip, label: `Finished ${days(endSlip)} late` };
    if (endSlip < 0) return { status: 'done-early', startSlip, endSlip, label: `Finished ${days(-endSlip)} early` };
    return { status: 'done', startSlip, endSlip: 0, label: 'Finished on time' };
  }
  if (today > task.end) {
    const endSlip = diffDays(task.end, today);
    return { status: 'overdue', startSlip, endSlip, label: `${days(endSlip)} overdue` };
  }
  if (actual.start || task.progress > 0) {
    const late = startSlip && startSlip > 0 ? ` (started ${days(startSlip)} late)` : '';
    return { status: 'in-progress', startSlip, endSlip: 0, label: `In progress${late}` };
  }
  if (today > task.start) return { status: 'late-start', startSlip, endSlip: 0, label: `Should have started ${days(startSlip ?? 0)} ago` };
  return { status: 'upcoming', startSlip: null, endSlip: 0, label: today === task.start ? 'Starts today' : `Starts in ${days(diffDays(today, task.start))}` };
}

export function isOverdue(task: Task, today: ISODate): boolean {
  return task.progress < 100 && task.end < today;
}

/** Open tasks whose end date falls within the next `n` days (today included). */
export function isDueWithin(task: Task, today: ISODate, n: number): boolean {
  return task.progress < 100 && task.end >= today && task.end <= addDays(today, n);
}

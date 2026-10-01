/** Totals over log entries: per member, per feature, and the member × feature matrix. */
import type { Entry, ISODate } from '../types.ts';

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

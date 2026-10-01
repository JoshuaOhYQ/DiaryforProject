/** Rows, time scale and header ticks for the Gantt chart. */
import type { Feature, ISODate, Task } from '../types.ts';
import type { Actuals } from './ganttMath.ts';
import { NEUTRAL } from '../lib/colours.ts';
import {
  addDays,
  addMonths,
  dayOfWeek,
  diffDays,
  endOfWeek,
  formatDate,
  fromDayNumber,
  maxDate,
  MONTHS,
  MONTHS_SHORT,
  minDate,
  startOfMonth,
  startOfWeek,
  toDayNumber,
} from '../lib/dates.ts';

export type Zoom = 'week' | 'month';

export const DAY_WIDTH: Record<Zoom, number> = { week: 30, month: 9 };
export const ROW_H = 36;
export const HEADER_H = 52;

export type GanttRow = { kind: 'group'; key: string; label: string; colour: string } | { kind: 'task'; key: string; task: Task };

export const NO_FEATURE_GROUP = '__no-feature';

/** Tasks grouped under their feature (in feature order), sorted by date within each group. */
export function buildRows(tasks: Task[], features: Feature[], onlyFeatureId: string | null = null): GanttRow[] {
  const sorted = [...tasks].sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end) || a.name.localeCompare(b.name));
  const rows: GanttRow[] = [];
  const groups: { id: string; label: string; colour: string }[] = [
    ...features.map((f) => ({ id: f.id, label: f.name, colour: f.colour })),
    { id: NO_FEATURE_GROUP, label: 'No feature', colour: NEUTRAL },
  ];
  const known = new Set(features.map((f) => f.id));
  for (const g of groups) {
    if (onlyFeatureId && g.id !== onlyFeatureId) continue;
    const inGroup = sorted.filter((t) => (g.id === NO_FEATURE_GROUP ? !t.featureId || !known.has(t.featureId) : t.featureId === g.id));
    if (!inGroup.length) continue;
    rows.push({ kind: 'group', key: `g-${g.id}`, label: g.label, colour: g.colour });
    for (const t of inGroup) rows.push({ kind: 'task', key: t.id, task: t });
  }
  return rows;
}

/** The date range to draw: every task and actual date, today, plus some breathing room. */
export function chartRange(tasks: Task[], actuals: Map<string, Actuals>, today: ISODate, zoom: Zoom, weekStartsOn: 0 | 1 = 1): { start: ISODate; end: ISODate } {
  let first = today;
  let last = today;
  for (const t of tasks) {
    const a = actuals.get(t.id);
    first = minDate(first, t.start, a?.start) ?? first;
    last = maxDate(last, t.end, a?.end) ?? last;
  }
  let start = startOfWeek(addDays(first, -7), weekStartsOn);
  let end = endOfWeek(addDays(last, 21), weekStartsOn);
  if (diffDays(start, end) < 62) end = endOfWeek(addDays(start, 62), weekStartsOn);
  if (zoom === 'month') {
    start = startOfMonth(start);
    end = addDays(startOfMonth(addMonths(end, 1)), -1);
  }
  return { start, end };
}

export interface Scale {
  start: ISODate;
  end: ISODate;
  dayW: number;
  days: number;
  width: number;
  /** Left edge of a date's column. */
  x(date: ISODate): number;
  /** The date under a horizontal pixel position. */
  dateAt(x: number): ISODate;
}

export function makeScale(start: ISODate, end: ISODate, zoom: Zoom): Scale {
  const dayW = DAY_WIDTH[zoom];
  const origin = toDayNumber(start);
  const days = diffDays(start, end) + 1;
  return {
    start,
    end,
    dayW,
    days,
    width: days * dayW,
    x: (date) => (toDayNumber(date) - origin) * dayW,
    dateAt: (x) => fromDayNumber(origin + Math.floor(x / dayW)),
  };
}

export interface Header {
  /** Month bands across the top. */
  months: { x: number; width: number; label: string }[];
  /** Day numbers (week zoom) or week-start dates (month zoom). */
  ticks: { x: number; width: number; label: string; sub?: string }[];
  /** Vertical grid lines; major ones mark weeks (week zoom) or months (month zoom). */
  lines: { x: number; major: boolean }[];
  weekends: { x: number; width: number }[];
}

export function buildHeader(scale: Scale, zoom: Zoom, weekStartsOn: 0 | 1 = 1): Header {
  const months: Header['months'] = [];
  for (let m = startOfMonth(scale.start); m <= scale.end; m = addMonths(m, 1)) {
    const from = m < scale.start ? scale.start : m;
    const next = addMonths(m, 1);
    const to = next > scale.end ? addDays(scale.end, 1) : next;
    const width = diffDays(from, to) * scale.dayW;
    const label = width > 90 ? `${MONTHS[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}` : `${MONTHS_SHORT[+m.slice(5, 7) - 1]}`;
    months.push({ x: scale.x(from), width, label });
  }

  const ticks: Header['ticks'] = [];
  const lines: Header['lines'] = [];
  const weekends: Header['weekends'] = [];
  for (let d = scale.start; d <= scale.end; d = addDays(d, 1)) {
    const x = scale.x(d);
    const dow = dayOfWeek(d);
    const weekStart = dow === weekStartsOn;
    if (zoom === 'week') {
      ticks.push({ x, width: scale.dayW, label: String(+d.slice(8, 10)), sub: formatDate(d, 'weekday').slice(0, 1) });
      if (dow === 0 || dow === 6) weekends.push({ x, width: scale.dayW });
      lines.push({ x, major: weekStart });
    } else {
      if (weekStart) {
        ticks.push({ x, width: 7 * scale.dayW, label: String(+d.slice(8, 10)) });
        lines.push({ x, major: d.endsWith('-01') });
      } else if (d.endsWith('-01')) {
        lines.push({ x, major: true });
      }
    }
  }
  return { months, ticks, lines, weekends };
}

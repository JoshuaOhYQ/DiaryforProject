/**
 * Calendar-date maths on "YYYY-MM-DD" strings.
 *
 * Dates are converted to whole day numbers (days since 1970-01-01, in UTC) so that
 * time zones and daylight saving can never shift a date by one.
 */
import type { ISODate } from '../types.ts';

const DAY_MS = 86_400_000;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));
export const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const pad = (n: number) => String(n).padStart(2, '0');

export function isISODate(value: unknown): value is ISODate {
  if (typeof value !== 'string') return false;
  const m = ISO_RE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

export function toDayNumber(iso: ISODate): number {
  const m = ISO_RE.exec(iso);
  if (!m) throw new Error(`Not a YYYY-MM-DD date: ${iso}`);
  return Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY_MS);
}

export function fromDayNumber(n: number): ISODate {
  const d = new Date(n * DAY_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function makeDate(year: number, month: number, day: number): ISODate | null {
  const iso = `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}`;
  return isISODate(iso) ? iso : null;
}

/** Today's date on this computer's clock (local time, not UTC). */
export function todayISO(now: Date = new Date()): ISODate {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function addDays(iso: ISODate, days: number): ISODate {
  return fromDayNumber(toDayNumber(iso) + days);
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function diffDays(from: ISODate, to: ISODate): number {
  return toDayNumber(to) - toDayNumber(from);
}

/** 0 = Sunday … 6 = Saturday */
export function dayOfWeek(iso: ISODate): number {
  return (((toDayNumber(iso) + 4) % 7) + 7) % 7; // 1970-01-01 was a Thursday
}

export function startOfWeek(iso: ISODate, weekStartsOn: 0 | 1 = 1): ISODate {
  return addDays(iso, -((dayOfWeek(iso) - weekStartsOn + 7) % 7));
}

export function endOfWeek(iso: ISODate, weekStartsOn: 0 | 1 = 1): ISODate {
  return addDays(startOfWeek(iso, weekStartsOn), 6);
}

export function startOfMonth(iso: ISODate): ISODate {
  return `${iso.slice(0, 7)}-01`;
}

export function addMonths(iso: ISODate, months: number): ISODate {
  const y = +iso.slice(0, 4);
  const m = +iso.slice(5, 7) - 1 + months;
  const year = y + Math.floor(m / 12);
  const month = ((m % 12) + 12) % 12;
  const day = Math.min(+iso.slice(8, 10), daysInMonth(year, month + 1));
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Every date from start to end inclusive. */
export function eachDay(start: ISODate, end: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let n = toDayNumber(start), last = toDayNumber(end); n <= last; n++) out.push(fromDayNumber(n));
  return out;
}

export function minDate(...dates: (ISODate | null | undefined)[]): ISODate | null {
  let best: ISODate | null = null;
  for (const d of dates) if (d && (best === null || d < best)) best = d;
  return best;
}

export function maxDate(...dates: (ISODate | null | undefined)[]): ISODate | null {
  let best: ISODate | null = null;
  for (const d of dates) if (d && (best === null || d > best)) best = d;
  return best;
}

export function isWithin(iso: ISODate, start: ISODate, end: ISODate): boolean {
  return iso >= start && iso <= end;
}

/** ISO-8601 week number (weeks start Monday; week 1 contains the first Thursday). */
export function isoWeekNumber(iso: ISODate): number {
  const thursday = addDays(iso, 3 - ((dayOfWeek(iso) + 6) % 7));
  const jan1 = `${thursday.slice(0, 4)}-01-01`;
  return Math.floor(diffDays(jan1, thursday) / 7) + 1;
}

/** "Mon 8 Sep 2026" (style 'long'), "8 Sep 2026" ('medium'), "8 Sep" ('short'), "Monday" ('weekday'). */
export function formatDate(iso: ISODate, style: 'long' | 'medium' | 'short' | 'weekday' | 'full' = 'medium'): string {
  if (!isISODate(iso)) return iso || '—';
  const y = +iso.slice(0, 4);
  const m = +iso.slice(5, 7) - 1;
  const d = +iso.slice(8, 10);
  const wd = WEEKDAYS_SHORT[dayOfWeek(iso)];
  switch (style) {
    case 'short':
      return `${d} ${MONTHS_SHORT[m]}`;
    case 'long':
      return `${wd} ${d} ${MONTHS_SHORT[m]} ${y}`;
    case 'full':
      return `${d} ${MONTHS[m]} ${y}`;
    case 'weekday':
      return wd;
    default:
      return `${d} ${MONTHS_SHORT[m]} ${y}`;
  }
}

/** "8–14 Sep 2026", "29 Sep – 5 Oct 2026", "29 Dec 2026 – 4 Jan 2027" */
export function formatRange(start: ISODate, end: ISODate): string {
  const [ys, ms, ds] = [+start.slice(0, 4), +start.slice(5, 7) - 1, +start.slice(8, 10)];
  const [ye, me, de] = [+end.slice(0, 4), +end.slice(5, 7) - 1, +end.slice(8, 10)];
  if (ys !== ye) return `${formatDate(start)} – ${formatDate(end)}`;
  if (ms !== me) return `${ds} ${MONTHS_SHORT[ms]} – ${de} ${MONTHS_SHORT[me]} ${ye}`;
  if (ds === de) return formatDate(start);
  return `${ds}–${de} ${MONTHS_SHORT[me]} ${ye}`;
}

/** "today", "yesterday", "3 days ago", "in 2 days" */
export function relativeDays(iso: ISODate, today: ISODate = todayISO()): string {
  const n = diffDays(today, iso);
  if (n === 0) return 'today';
  if (n === -1) return 'yesterday';
  if (n === 1) return 'tomorrow';
  return n < 0 ? `${-n} days ago` : `in ${n} days`;
}

const MONTH_LOOKUP: Record<string, number> = {};
MONTHS.forEach((name, i) => {
  MONTH_LOOKUP[name.toLowerCase()] = i + 1;
  MONTH_LOOKUP[name.slice(0, 3).toLowerCase()] = i + 1;
});
MONTH_LOOKUP['sept'] = 9;

const MONTH_NAMES = Object.keys(MONTH_LOOKUP).sort((a, b) => b.length - a.length).join('|');
const DMY_WORDS = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_NAMES})\\.?(?:,?\\s+(\\d{4}))?\\b`, 'i');
const MDY_WORDS = new RegExp(`\\b(${MONTH_NAMES})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, 'i');

/**
 * Find a date written in common formats inside free text. Numeric dates are read
 * day-first (8/9/2026 = 8 September), which is the convention in Malaysia and the UK.
 */
export function findDateInText(text: string, fallbackYear?: number): ISODate | null {
  let m = /\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/.exec(text);
  if (m) return makeDate(+m[1], +m[2], +m[3]);
  m = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/.exec(text);
  if (m) {
    const year = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return makeDate(year, +m[2], +m[1]);
  }
  m = DMY_WORDS.exec(text);
  if (m) {
    const year = m[3] ? +m[3] : fallbackYear;
    return year ? makeDate(year, MONTH_LOOKUP[m[2].toLowerCase()], +m[1]) : null;
  }
  m = MDY_WORDS.exec(text);
  if (m) {
    const year = m[3] ? +m[3] : fallbackYear;
    return year ? makeDate(year, MONTH_LOOKUP[m[1].toLowerCase()], +m[2]) : null;
  }
  return null;
}

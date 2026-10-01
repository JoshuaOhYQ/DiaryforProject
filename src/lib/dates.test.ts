import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  dayOfWeek,
  diffDays,
  eachDay,
  endOfWeek,
  findDateInText,
  formatRange,
  isISODate,
  isoWeekNumber,
  startOfWeek,
  todayISO,
} from './dates.ts';

describe('date maths', () => {
  it('validates dates', () => {
    expect(isISODate('2026-10-09')).toBe(true);
    expect(isISODate('2026-02-30')).toBe(false);
    expect(isISODate('9/10/2026')).toBe(false);
  });

  it('adds days across month and year ends', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
  });

  it('counts days between dates', () => {
    expect(diffDays('2026-10-01', '2026-10-09')).toBe(8);
    expect(diffDays('2026-10-09', '2026-10-01')).toBe(-8);
  });

  it('knows the day of the week', () => {
    expect(dayOfWeek('2026-10-09')).toBe(5); // Friday
    expect(dayOfWeek('2026-09-07')).toBe(1); // Monday
  });

  it('finds week boundaries (Monday and Sunday starts)', () => {
    expect(startOfWeek('2026-10-09', 1)).toBe('2026-10-05');
    expect(endOfWeek('2026-10-09', 1)).toBe('2026-10-11');
    expect(startOfWeek('2026-10-11', 1)).toBe('2026-10-05');
    expect(startOfWeek('2026-10-09', 0)).toBe('2026-10-04');
  });

  it('adds months without overflowing short months', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-11-15', 2)).toBe('2027-01-15');
  });

  it('computes ISO week numbers', () => {
    expect(isoWeekNumber('2026-01-01')).toBe(1);
    expect(isoWeekNumber('2026-10-09')).toBe(41);
    expect(isoWeekNumber('2027-01-01')).toBe(53);
  });

  it('lists every day in a range', () => {
    expect(eachDay('2026-09-29', '2026-10-02')).toEqual(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
  });

  it('formats ranges compactly', () => {
    expect(formatRange('2026-09-07', '2026-09-13')).toBe('7–13 Sep 2026');
    expect(formatRange('2026-09-28', '2026-10-04')).toBe('28 Sep – 4 Oct 2026');
  });

  it('uses the local calendar date for today', () => {
    expect(todayISO(new Date(2026, 9, 1, 23, 30))).toBe('2026-10-01');
  });

  it('finds dates written in common styles (day first)', () => {
    expect(findDateInText('8 September 2026')).toBe('2026-09-08');
    expect(findDateInText('Mon 8th Sep, 2026 — broker')).toBe('2026-09-08');
    expect(findDateInText('September 8, 2026')).toBe('2026-09-08');
    expect(findDateInText('2026-09-08 notes')).toBe('2026-09-08');
    expect(findDateInText('08/09/2026')).toBe('2026-09-08');
    expect(findDateInText('9 Oct', 2026)).toBe('2026-10-09');
    expect(findDateInText('no date here')).toBeNull();
  });
});

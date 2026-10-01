import { describe, expect, it } from 'vitest';
import { newEntry } from '../data/factories.ts';
import { buildMatrix, daysSinceLastEntry, NO_FEATURE, recentWeeks, tallyBy, weeklyByMember } from './stats.ts';

const e = (authorId: string, featureId: string | null, hours: number, date = '2026-10-01') => newEntry('p', { authorId, featureId, hours, date });

describe('dashboard stats', () => {
  const entries = [e('ana', null, 2, '2026-09-21'), e('ana', null, 1, '2026-09-27'), e('ana', null, 3, '2026-10-01'), e('ben', null, 4, '2026-08-01')];

  it('lists recent week starts, oldest first', () => {
    expect(recentWeeks('2026-10-01', 3, 1)).toEqual(['2026-09-14', '2026-09-21', '2026-09-28']);
  });

  it('adds hours per member per week, with zeros for quiet weeks', () => {
    const weeks = recentWeeks('2026-10-01', 3, 1);
    const m = weeklyByMember(entries, ['ana', 'ben', 'cat'], weeks, 1);
    expect(m.get('ana')!.map((w) => w.hours)).toEqual([0, 3, 3]);
    expect(m.get('ana')![1].count).toBe(2);
    expect(m.get('ben')!.map((w) => w.hours)).toEqual([0, 0, 0]);
    expect(m.get('cat')!.map((w) => w.hours)).toEqual([0, 0, 0]);
  });

  it('counts days since each member last logged', () => {
    const d = daysSinceLastEntry(entries, ['ana', 'ben', 'cat'], '2026-10-04');
    expect(d.get('ana')).toBe(3);
    expect(d.get('ben')).toBe(64);
    expect(d.get('cat')).toBeNull();
  });
});


describe('who-did-what matrix', () => {
  const entries = [e('ana', 'mqtt', 2), e('ana', 'mqtt', 1.5, '2026-10-03'), e('ana', null, 1), e('ben', 'voice', 3), e('ben', 'mqtt', 0.25)];
  const m = buildMatrix(entries);

  it('adds hours and counts per cell', () => {
    expect(m.cell('ana', 'mqtt')).toMatchObject({ hours: 3.5, count: 2, last: '2026-10-03' });
    expect(m.cell('ben', 'mqtt')).toMatchObject({ hours: 0.25, count: 1 });
    expect(m.cell('ben', 'report')).toMatchObject({ hours: 0, count: 0, last: null });
  });

  it('keeps entries without a feature in their own column', () => {
    expect(m.cell('ana', NO_FEATURE).hours).toBe(1);
  });

  it('totals rows, columns and everything', () => {
    expect(m.byMember.get('ana')!.hours).toBe(4.5);
    expect(m.byFeature.get('mqtt')!.hours).toBe(3.75);
    expect(m.total).toMatchObject({ hours: 7.75, count: 5 });
    expect(m.maxHours).toBe(3.5);
  });

  it('avoids floating point drift', () => {
    const t = tallyBy([e('a', null, 0.1), e('a', null, 0.2)], () => 'x');
    expect(t.get('x')!.hours).toBe(0.3);
  });
});

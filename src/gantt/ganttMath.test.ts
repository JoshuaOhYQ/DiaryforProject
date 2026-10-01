import { describe, expect, it } from 'vitest';
import type { Task } from '../types.ts';
import { newEntry, newTask } from '../data/factories.ts';
import {
  actualsFor,
  cascadeDependents,
  dependencyConflicts,
  earliestStartAfter,
  isDueWithin,
  isOverdue,
  moveTask,
  resizeTask,
  slippage,
  taskDays,
  wouldCreateCycle,
} from './ganttMath.ts';

const task = (id: string, start: string, end: string, extra: Partial<Task> = {}) => newTask('p', { id, name: id, start, end, ...extra });

describe('moving and resizing', () => {
  const t = task('a', '2026-10-05', '2026-10-09');

  it('counts days inclusively', () => {
    expect(taskDays(t)).toBe(5);
    expect(taskDays(task('m', '2026-10-09', '2026-10-09', { milestone: true }))).toBe(1);
  });

  it('moves both ends and keeps the length', () => {
    expect(moveTask(t, 3)).toMatchObject({ start: '2026-10-08', end: '2026-10-12' });
    expect(moveTask(t, -7)).toMatchObject({ start: '2026-09-28', end: '2026-10-02' });
  });

  it('resizes one end but never past the other', () => {
    expect(resizeTask(t, 'end', 2)).toMatchObject({ start: '2026-10-05', end: '2026-10-11' });
    expect(resizeTask(t, 'start', 10)).toMatchObject({ start: '2026-10-09', end: '2026-10-09' });
    expect(resizeTask(t, 'end', -10)).toMatchObject({ start: '2026-10-05', end: '2026-10-05' });
  });

  it('moves a milestone instead of stretching it', () => {
    const m = task('m', '2026-10-09', '2026-10-09', { milestone: true });
    expect(resizeTask(m, 'end', 2)).toMatchObject({ start: '2026-10-11', end: '2026-10-11' });
  });
});

describe('dependencies (finish-to-start)', () => {
  it('starts the day after a task, or the same day as a milestone', () => {
    const a = task('a', '2026-10-01', '2026-10-05');
    const m = task('m', '2026-10-09', '2026-10-09', { milestone: true });
    expect(earliestStartAfter(a, task('b', '2026-10-06', '2026-10-07'))).toBe('2026-10-06');
    expect(earliestStartAfter(m, task('b', '2026-10-06', '2026-10-07'))).toBe('2026-10-09');
    expect(earliestStartAfter(a, m)).toBe('2026-10-05');
  });

  it('finds tasks that start too early', () => {
    const a = task('a', '2026-10-01', '2026-10-05');
    const b = task('b', '2026-10-04', '2026-10-08', { dependsOn: ['a'] });
    const c = task('c', '2026-10-06', '2026-10-08', { dependsOn: ['a'] });
    expect(dependencyConflicts([a, b, c])).toEqual([{ taskId: 'b', dependsOnId: 'a', days: 2 }]);
  });

  it('detects cycles, including indirect ones', () => {
    const a = task('a', '2026-10-01', '2026-10-02');
    const b = task('b', '2026-10-03', '2026-10-04', { dependsOn: ['a'] });
    const c = task('c', '2026-10-05', '2026-10-06', { dependsOn: ['b'] });
    const all = [a, b, c];
    expect(wouldCreateCycle(all, 'a', 'c')).toBe(true);
    expect(wouldCreateCycle(all, 'a', 'a')).toBe(true);
    expect(wouldCreateCycle(all, 'c', 'a')).toBe(false);
  });

  it('pushes a chain of dependents later, keeping their lengths', () => {
    const a = task('a', '2026-10-01', '2026-10-05');
    const b = task('b', '2026-10-06', '2026-10-08', { dependsOn: ['a'] });
    const c = task('c', '2026-10-09', '2026-10-09', { dependsOn: ['b'], milestone: true });
    const d = task('d', '2026-10-20', '2026-10-21', { dependsOn: ['a'] }); // has slack: stays put
    const movedA = moveTask(a, 4); // now ends 9 Oct
    const moved = cascadeDependents([a, b, c, d], [movedA]);
    expect(moved.find((t) => t.id === 'b')).toMatchObject({ start: '2026-10-10', end: '2026-10-12' });
    expect(moved.find((t) => t.id === 'c')).toMatchObject({ start: '2026-10-12', end: '2026-10-12' });
    expect(moved.find((t) => t.id === 'd')).toBeUndefined();
  });

  it('waits for the latest of several prerequisites', () => {
    const a = task('a', '2026-10-01', '2026-10-03');
    const b = task('b', '2026-10-01', '2026-10-07');
    const c = task('c', '2026-10-08', '2026-10-09', { dependsOn: ['a', 'b'] });
    const moved = cascadeDependents([a, b, c], [moveTask(a, 10)]);
    expect(moved[0]).toMatchObject({ id: 'c', start: '2026-10-14', end: '2026-10-15' });
  });

  it('never pulls dependents earlier', () => {
    const a = task('a', '2026-10-01', '2026-10-05');
    const b = task('b', '2026-10-06', '2026-10-08', { dependsOn: ['a'] });
    expect(cascadeDependents([a, b], [moveTask(a, -3)])).toEqual([]);
  });

  it('survives a cycle in the data without hanging', () => {
    const a = task('a', '2026-10-01', '2026-10-02', { dependsOn: ['b'] });
    const b = task('b', '2026-10-03', '2026-10-04', { dependsOn: ['a'] });
    expect(() => cascadeDependents([a, b], [moveTask(a, 5)])).not.toThrow();
  });
});

describe('planned vs actual', () => {
  const t = task('t', '2026-10-05', '2026-10-09');
  const log = (date: string, hours = 1, taskId = 't') => newEntry('p', { date, hours, taskId, authorId: 'x' });

  it('takes actual dates from linked entries', () => {
    const a = actualsFor('t', [log('2026-10-07', 2), log('2026-10-06'), log('2026-10-12', 1.5), log('2026-10-01', 9, 'other')]);
    expect(a).toEqual({ start: '2026-10-06', end: '2026-10-12', hours: 4.5, entryCount: 3 });
  });

  it('reports a task finished late from its last entry', () => {
    const done = { ...t, progress: 100 };
    const s = slippage(done, actualsFor('t', [log('2026-10-06'), log('2026-10-12')]), '2026-10-20');
    expect(s).toMatchObject({ status: 'done-late', startSlip: 1, endSlip: 3 });
  });

  it('reports a task finished early', () => {
    const s = slippage({ ...t, progress: 100 }, actualsFor('t', [log('2026-10-05'), log('2026-10-07')]), '2026-10-20');
    expect(s).toMatchObject({ status: 'done-early', endSlip: -2 });
  });

  it('reports an open task past its end date as overdue', () => {
    const s = slippage({ ...t, progress: 60 }, actualsFor('t', [log('2026-10-08')]), '2026-10-12');
    expect(s).toMatchObject({ status: 'overdue', startSlip: 3, endSlip: 3 });
  });

  it('notices a task that should have started', () => {
    const s = slippage(t, actualsFor('t', []), '2026-10-07');
    expect(s).toMatchObject({ status: 'late-start', startSlip: 2 });
  });

  it('is on track before the start date', () => {
    expect(slippage(t, actualsFor('t', []), '2026-10-01')).toMatchObject({ status: 'upcoming', startSlip: null, endSlip: 0 });
  });

  it('flags overdue and due-soon tasks for the dashboard', () => {
    expect(isOverdue(t, '2026-10-10')).toBe(true);
    expect(isOverdue({ ...t, progress: 100 }, '2026-10-10')).toBe(false);
    expect(isDueWithin(t, '2026-10-02', 7)).toBe(true);
    expect(isDueWithin(t, '2026-09-30', 7)).toBe(false);
  });
});

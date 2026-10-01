import { describe, expect, it } from 'vitest';
import type { Workspace } from '../types.ts';
import { applyChanges } from './changes.ts';
import { newEntry, newMember, newProject } from './factories.ts';
import { mergeWorkspaces, parseLogbookText, sameWorkspace, splitConflictMarkers } from './merge.ts';
import { emptyWorkspace, normalizeWorkspace, parseWorkspace, serializeWorkspace } from './workspace.ts';

const T1 = '2026-10-01T08:00:00.000Z';
const T2 = '2026-10-01T09:00:00.000Z';
const T3 = '2026-10-01T10:00:00.000Z';

function base(): { ws: Workspace; projectId: string; memberId: string } {
  const project = newProject({ name: 'Test' });
  const member = newMember(project.id, { name: 'Ana' });
  const ws = applyChanges(emptyWorkspace(), { put: { projects: [project], members: [member] } }, T1);
  return { ws, projectId: project.id, memberId: member.id };
}

describe('mergeWorkspaces', () => {
  it('keeps entries added on both sides', () => {
    const { ws, projectId, memberId } = base();
    const a = applyChanges(ws, { put: { entries: [newEntry(projectId, { authorId: memberId, did: 'from A' })] } }, T2);
    const b = applyChanges(ws, { put: { entries: [newEntry(projectId, { authorId: memberId, did: 'from B' })] } }, T2);
    const merged = mergeWorkspaces(a, b);
    expect(merged.entries.map((e) => e.did).sort()).toEqual(['from A', 'from B']);
  });

  it('keeps the newer edit of the same record', () => {
    const { ws, projectId, memberId } = base();
    const entry = newEntry(projectId, { authorId: memberId, did: 'v1' });
    const start = applyChanges(ws, { put: { entries: [entry] } }, T1);
    const a = applyChanges(start, { put: { entries: [{ ...start.entries[0], did: 'older edit' }] } }, T2);
    const b = applyChanges(start, { put: { entries: [{ ...start.entries[0], did: 'newer edit' }] } }, T3);
    expect(mergeWorkspaces(a, b).entries[0].did).toBe('newer edit');
    expect(mergeWorkspaces(b, a).entries[0].did).toBe('newer edit');
  });

  it('applies deletions from either side', () => {
    const { ws, projectId, memberId } = base();
    const start = applyChanges(ws, { put: { entries: [newEntry(projectId, { authorId: memberId })] } }, T1);
    const deleted = applyChanges(start, { del: [{ collection: 'entries', id: start.entries[0].id }] }, T2);
    expect(mergeWorkspaces(start, deleted).entries).toHaveLength(0);
    expect(mergeWorkspaces(deleted, start).entries).toHaveLength(0);
  });

  it('keeps a record that was edited after it was deleted elsewhere', () => {
    const { ws, projectId, memberId } = base();
    const start = applyChanges(ws, { put: { entries: [newEntry(projectId, { authorId: memberId })] } }, T1);
    const deleted = applyChanges(start, { del: [{ collection: 'entries', id: start.entries[0].id }] }, T2);
    const edited = applyChanges(start, { put: { entries: [{ ...start.entries[0], did: 'still needed' }] } }, T3);
    expect(mergeWorkspaces(deleted, edited).entries[0].did).toBe('still needed');
  });

  it('is order independent and idempotent', () => {
    const { ws, projectId, memberId } = base();
    const a = applyChanges(ws, { put: { entries: [newEntry(projectId, { authorId: memberId, did: 'a' })] } }, T2);
    const b = applyChanges(ws, { put: { entries: [newEntry(projectId, { authorId: memberId, did: 'b' })] } }, T3);
    const ab = mergeWorkspaces(a, b);
    expect(sameWorkspace(ab, mergeWorkspaces(b, a))).toBe(true);
    expect(sameWorkspace(ab, mergeWorkspaces(ab, a))).toBe(true);
    expect(sameWorkspace(ab, mergeWorkspaces(ab, ab))).toBe(true);
  });
});

describe('workspace file format', () => {
  it('round-trips through JSON and is stable', () => {
    const { ws } = base();
    const text = serializeWorkspace(ws);
    expect(serializeWorkspace(parseWorkspace(text))).toBe(text);
  });

  it('fills in missing fields and keeps unknown ones', () => {
    const ws = normalizeWorkspace({ entries: [{ id: 'e1', date: '2026-10-01', hours: '1.5', futureField: 42 }] });
    expect(ws.entries[0].hours).toBe(1.5);
    expect(ws.entries[0].tags).toEqual([]);
    expect((ws.entries[0] as unknown as Record<string, unknown>).futureField).toBe(42);
  });

  it('rejects files that are not log books', () => {
    expect(() => parseWorkspace('[1,2,3]')).toThrow();
    expect(() => parseWorkspace('{"hello":1}')).toThrow();
    expect(() => parseWorkspace('not json')).toThrow();
  });
});

describe('git conflict recovery', () => {
  it('rebuilds both sides of a conflicted logbook.json and merges them', () => {
    const { ws, projectId, memberId } = base();
    const a = applyChanges(ws, { put: { entries: [newEntry(projectId, { authorId: memberId, did: 'mine' })] } }, T2);
    const b = applyChanges(ws, { put: { entries: [newEntry(projectId, { authorId: memberId, did: 'theirs' })] } }, T3);
    const aLines = serializeWorkspace(a).split('\n');
    const bLines = serializeWorkspace(b).split('\n');
    // Build a conflict the way Git does: common prefix, then both versions of the differing middle.
    let start = 0;
    while (aLines[start] === bLines[start]) start++;
    let endA = aLines.length - 1;
    let endB = bLines.length - 1;
    while (aLines[endA] === bLines[endB]) endA--, endB--;
    const conflicted = [
      ...aLines.slice(0, start),
      '<<<<<<< HEAD',
      ...aLines.slice(start, endA + 1),
      '=======',
      ...bLines.slice(start, endB + 1),
      '>>>>>>> origin/main',
      ...aLines.slice(endA + 1),
    ].join('\n');

    const { ours, theirs } = splitConflictMarkers(conflicted);
    expect(JSON.parse(ours).entries[0].did).toBe('mine');
    expect(JSON.parse(theirs).entries[0].did).toBe('theirs');
    expect(parseLogbookText(conflicted).entries.map((e) => e.did).sort()).toEqual(['mine', 'theirs']);
  });
});

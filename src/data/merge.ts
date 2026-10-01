/**
 * Record-by-record merge of two copies of the log book.
 *
 * - Records are matched by id. If both sides have one, the newer `updatedAt` wins.
 * - Deletions are kept as tombstones, so a deletion on one side removes the record on the other
 *   (unless the record was edited after it was deleted).
 *
 * The merge gives the same answer whichever order you merge in, and merging twice changes nothing.
 * That is what lets several browsers, a Git pull and the Git merge driver all combine safely.
 */
import type { CollectionName, Tombstone, Workspace } from '../types.ts';
import { COLLECTIONS, emptyWorkspace, parseWorkspace, serializeWorkspace, sortWorkspace } from './workspace.ts';

interface Versioned {
  id: string;
  updatedAt: string;
}

function isNewer(a: Versioned, b: Versioned): boolean {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt;
  // Same timestamp: pick deterministically so both sides agree.
  return JSON.stringify(a) > JSON.stringify(b);
}

export function mergeWorkspaces(a: Workspace, b: Workspace): Workspace {
  const tombstones = new Map<string, Tombstone>();
  for (const t of [...a.tombstones, ...b.tombstones]) {
    const existing = tombstones.get(t.id);
    if (!existing || t.deletedAt > existing.deletedAt) tombstones.set(t.id, t);
  }

  const out = emptyWorkspace();
  for (const c of COLLECTIONS) {
    const byId = new Map<string, Versioned>();
    for (const r of a[c] as Versioned[]) byId.set(r.id, r);
    for (const r of b[c] as Versioned[]) {
      const existing = byId.get(r.id);
      if (!existing || isNewer(r, existing)) byId.set(r.id, r);
    }
    (out[c] as Versioned[]) = [...byId.values()].filter((r) => {
      const t = tombstones.get(r.id);
      return !t || r.updatedAt > t.deletedAt;
    });
  }
  out.tombstones = [...tombstones.values()];
  return sortWorkspace(out);
}

export function sameWorkspace(a: Workspace, b: Workspace): boolean {
  return serializeWorkspace(a) === serializeWorkspace(b);
}

export function tombstoneFor(collection: CollectionName, id: string, deletedAt: string): Tombstone {
  return { id, collection, deletedAt };
}

const CONFLICT_START = /^<{7}(\s|$)/m;

/**
 * Read logbook.json text. If Git left conflict markers in it (<<<<<<< ======= >>>>>>>),
 * rebuild "our" and "their" versions and merge them, so nobody has to hand-edit JSON.
 */
export function parseLogbookText(text: string): Workspace {
  if (!CONFLICT_START.test(text)) return parseWorkspace(text);
  const { ours, theirs } = splitConflictMarkers(text);
  return mergeWorkspaces(parseWorkspace(ours), parseWorkspace(theirs));
}

export function splitConflictMarkers(text: string): { ours: string; theirs: string } {
  const ours: string[] = [];
  const theirs: string[] = [];
  let state: 'both' | 'ours' | 'base' | 'theirs' = 'both';
  for (const line of text.split(/\r?\n/)) {
    if (/^<{7}(\s|$)/.test(line)) state = 'ours';
    else if (/^\|{7}(\s|$)/.test(line) && state === 'ours') state = 'base';
    else if (/^={7}\s*$/.test(line) && state !== 'both') state = 'theirs';
    else if (/^>{7}(\s|$)/.test(line) && state === 'theirs') state = 'both';
    else {
      if (state === 'both' || state === 'ours') ours.push(line);
      if (state === 'both' || state === 'theirs') theirs.push(line);
    }
  }
  return { ours: ours.join('\n'), theirs: theirs.join('\n') };
}

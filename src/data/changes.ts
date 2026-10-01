/** A batch of record writes and deletes, applied in one go. Pure, so scripts and tests can use it too. */
import type { CollectionName, RecordOf, Workspace } from '../types.ts';
import { COLLECTIONS, normalizeRecord, sortWorkspace } from './workspace.ts';

export type Puts = { [C in CollectionName]?: RecordOf<C>[] };

export interface Changes {
  put?: Puts;
  del?: { collection: CollectionName; id: string }[];
}

export function applyChanges(ws: Workspace, changes: Changes, now: string): Workspace {
  const next: Workspace = { ...ws };
  const dels = changes.del ?? [];
  for (const c of COLLECTIONS) {
    const puts = (changes.put?.[c] ?? []) as RecordOf<typeof c>[];
    const delIds = new Set(dels.filter((d) => d.collection === c).map((d) => d.id));
    if (!puts.length && !delIds.size) continue;
    const byId = new Map<string, RecordOf<typeof c>>(ws[c].map((r) => [r.id, r]));
    for (const r of puts) {
      const prev = byId.get(r.id);
      byId.set(r.id, normalizeRecord(c, { ...r, createdAt: prev?.createdAt ?? now, updatedAt: now }));
    }
    for (const id of delIds) byId.delete(id);
    (next[c] as RecordOf<typeof c>[]) = [...byId.values()];
  }
  if (dels.length) {
    const deleted = new Set(dels.map((d) => d.id));
    next.tombstones = [...ws.tombstones.filter((t) => !deleted.has(t.id)), ...dels.map((d) => ({ id: d.id, collection: d.collection, deletedAt: now }))];
  }
  return sortWorkspace(next);
}

/** Merge two change sets (later ones win for the same record). */
export function combineChanges(...sets: Changes[]): Changes {
  const put: Puts = {};
  const del: NonNullable<Changes['del']> = [];
  for (const s of sets) {
    for (const c of COLLECTIONS) {
      const list = s.put?.[c];
      if (list?.length) (put[c] as RecordOf<typeof c>[]) = [...((put[c] as RecordOf<typeof c>[]) ?? []), ...list];
    }
    if (s.del) del.push(...s.del);
  }
  return { put, del };
}

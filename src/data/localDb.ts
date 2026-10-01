/** IndexedDB storage in this browser: the working copy of the log book and attachment files. */
import { openDB, type IDBPDatabase } from 'idb';
import type { Workspace } from '../types.ts';
import { mergeWorkspaces } from './merge.ts';
import { normalizeWorkspace } from './workspace.ts';

const KV = 'kv';
const BLOBS = 'blobs';
const WORKSPACE_KEY = 'workspace';

export interface LocalDb {
  loadWorkspace(): Promise<Workspace | null>;
  /** Merge with whatever another tab may have saved, store the result and return it. */
  mergeAndSave(ws: Workspace): Promise<Workspace>;
  /** Overwrite without merging (used by Restore). */
  replace(ws: Workspace): Promise<void>;
  getBlob(id: string): Promise<Blob | undefined>;
  putBlob(id: string, blob: Blob): Promise<void>;
  getKv<T>(key: string): Promise<T | undefined>;
  setKv(key: string, value: unknown): Promise<void>;
  deleteKv(key: string): Promise<void>;
}

export function openLocalDb(name = 'project-logbook'): LocalDb {
  let dbPromise: Promise<IDBPDatabase> | null = null;
  const db = () =>
    (dbPromise ??= openDB(name, 1, {
      upgrade(d) {
        d.createObjectStore(KV);
        d.createObjectStore(BLOBS);
      },
    }));

  return {
    async loadWorkspace() {
      const raw = await (await db()).get(KV, WORKSPACE_KEY);
      return raw ? normalizeWorkspace(raw) : null;
    },
    async mergeAndSave(ws) {
      const tx = (await db()).transaction(KV, 'readwrite');
      const raw = await tx.store.get(WORKSPACE_KEY);
      const merged = raw ? mergeWorkspaces(normalizeWorkspace(raw), ws) : ws;
      await tx.store.put(merged, WORKSPACE_KEY);
      await tx.done;
      return merged;
    },
    async replace(ws) {
      await (await db()).put(KV, ws, WORKSPACE_KEY);
    },
    async getBlob(id) {
      return (await db()).get(BLOBS, id);
    },
    async putBlob(id, blob) {
      await (await db()).put(BLOBS, blob, id);
    },
    async getKv<T>(key: string) {
      return (await (await db()).get(KV, key)) as T | undefined;
    },
    async setKv(key, value) {
      await (await db()).put(KV, value, key);
    },
    async deleteKv(key) {
      await (await db()).delete(KV, key);
    },
  };
}

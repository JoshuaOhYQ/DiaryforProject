/**
 * Where data/logbook.json lives, depending on how the app is being run:
 *
 *  - dev-server  `npm run dev`: the Vite plugin writes straight into the repo's data/ folder.
 *  - folder      deployed site in Chrome/Edge: you pick the repo's data/ folder once and the app writes there.
 *  - static      deployed site, read-only: shows the log book that was committed when the site was built.
 *
 * When the log book is locked (see src/data/sealed.ts) the same targets read and write each
 * project's encrypted files instead, using the keys from the login page. Only the projects this
 * session has keys for are read or written. Nothing leaves the browser unencrypted.
 */
import type { Workspace } from '../types.ts';
import {
  ADMIN_HEADER,
  decryptBytes,
  encryptBytes,
  exportKey,
  isLockInfo,
  LOCK_FILE,
  PROJECT_HEADER,
  type LockInfo,
  type LockProof,
  type ProjectKeys,
} from '../lib/lock.ts';
import { mergeWorkspaces, parseLogbookText } from './merge.ts';
import { mimeForAsset, openWorkspaceText, PROJECTS_DIR, projectAssetPath, projectWorkspacePath, sealWorkspaceText, WORKSPACE_FILE } from './sealed.ts';
import { parseWorkspace, projectIdsIn, projectSlice, restrictWorkspace, serializeWorkspace } from './workspace.ts';

export type TargetKind = 'dev-server' | 'folder' | 'static';

export interface FileTarget {
  kind: TargetKind;
  /** Shown in the "Last saved" indicator. */
  label: string;
  writable: boolean;
  readWorkspace(): Promise<string | null>;
  writeWorkspace(text: string): Promise<void>;
  /** `file` is the AttachmentRef path ("assets/x.png"); `projectId` is the project of the entry it is attached to. */
  readAsset(file: string, projectId: string): Promise<Blob | null>;
  writeAsset(file: string, blob: Blob, projectId: string): Promise<void>;
  /** data/lock.json, or null when the log book is not locked. */
  readLock(): Promise<LockInfo | null>;
  /** The dev server needs the admin key to add a project, and the project's key to rename or remove it. */
  writeLock(info: LockInfo, proof?: LockProof): Promise<void>;
  /** Delete data/projects/<id>/ (only once the project is off lock.json). */
  removeProject(projectId: string): Promise<void>;
}

const base = () => import.meta.env.BASE_URL ?? '/';
export const dataUrl = (file: string) => `${base()}data/${file}`;

async function fetchOrNull(url: string): Promise<Response | null> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    return res.ok ? res : null;
  } catch {
    return null;
  }
}

/** Set by the login page when the log book is locked: the data key of each project this session can open. */
let dataKeys: ProjectKeys | null = null;
export function setDataKeys(keys: ProjectKeys | null) {
  dataKeys = keys;
}
export const getDataKeys = (): ProjectKeys | null => dataKeys;

/** Ids of the projects this session can open, or null when the log book is not locked. */
export function dataScope(): ReadonlySet<string> | null {
  return dataKeys ? new Set(dataKeys.keys()) : null;
}

/** Plain file access inside data/ (paths like "logbook.json" or "assets/x.png"). */
export interface RawFiles {
  readText(file: string): Promise<string | null>;
  readBlob(file: string): Promise<Blob | null>;
  writeText(file: string, text: string, headers?: Record<string, string>): Promise<void>;
  writeBlob(file: string, blob: Blob): Promise<void>;
  /** Delete a folder inside data/ and everything in it. */
  removeDir(dir: string): Promise<void>;
}

type Codec = Pick<FileTarget, 'readWorkspace' | 'writeWorkspace' | 'readAsset' | 'writeAsset' | 'readLock' | 'writeLock' | 'removeProject'>;

/**
 * The workspace and asset methods of a target. When the log book is locked, the workspace is
 * split by project and each part is encrypted with that project's key. Exported for tests.
 */
export function codec(raw: RawFiles, keys: () => ProjectKeys | null = () => dataKeys): Codec {
  return {
    async readWorkspace() {
      const k = keys();
      if (!k) return raw.readText(WORKSPACE_FILE);
      let ws: Workspace | null = null;
      for (const [id, key] of k) {
        const text = await raw.readText(projectWorkspacePath(id));
        if (text === null) continue;
        // Throws on a wrong key, so a save never overwrites a file it could not read.
        const part = restrictWorkspace(parseLogbookText(await openWorkspaceText(key, text)), new Set([id]));
        ws = ws ? mergeWorkspaces(ws, part) : part;
      }
      return ws && serializeWorkspace(ws);
    },
    async writeWorkspace(text) {
      const k = keys();
      if (!k) return raw.writeText(WORKSPACE_FILE, text);
      const ws = parseWorkspace(text);
      const present = projectIdsIn(ws);
      for (const [id, key] of k) {
        if (!present.has(id)) continue;
        const json = serializeWorkspace(projectSlice(ws, id));
        const file = projectWorkspacePath(id);
        const current = await raw.readText(file);
        // Every write re-encrypts with a fresh IV, so leave unchanged projects alone to keep Git quiet.
        if (current !== null && (await openWorkspaceText(key, current)) === json) continue;
        await raw.writeText(file, await sealWorkspaceText(key, json));
      }
    },
    async readAsset(file, projectId) {
      const k = keys();
      if (!k) return raw.readBlob(file);
      const key = k.get(projectId);
      const blob = key ? await raw.readBlob(projectAssetPath(projectId, file)) : null;
      if (!key || !blob) return null;
      return new Blob([await decryptBytes(key, new Uint8Array(await blob.arrayBuffer()))], { type: mimeForAsset(file) });
    },
    async writeAsset(file, blob, projectId) {
      const k = keys();
      if (!k) return raw.writeBlob(file, blob);
      const key = k.get(projectId);
      if (!key) return; // not one of this session's projects
      const path = projectAssetPath(projectId, file);
      // Attachments never change, so an existing file is already right (re-encrypting would only churn Git).
      if (await raw.readBlob(path)) return;
      await raw.writeBlob(path, new Blob([await encryptBytes(key, new Uint8Array(await blob.arrayBuffer()))]));
    },
    async readLock() {
      const text = await raw.readText(LOCK_FILE);
      if (!text) return null;
      try {
        const info: unknown = JSON.parse(text);
        return isLockInfo(info) ? info : null;
      } catch {
        return null;
      }
    },
    async writeLock(info, proof = {}) {
      const headers: Record<string, string> = {};
      if (proof.adminKey) headers[ADMIN_HEADER] = await exportKey(proof.adminKey);
      if (proof.projectKey) headers[PROJECT_HEADER] = await exportKey(proof.projectKey);
      await raw.writeText(LOCK_FILE, JSON.stringify(info, null, 2) + '\n', headers);
    },
    async removeProject(projectId) {
      await raw.removeDir(`${PROJECTS_DIR}/${projectId}`);
    },
  };
}

/** The label shown for a target writing into `dir`. */
const targetLabel = (dir: string) => (dataKeys ? `${dir}/projects` : `${dir}/${WORKSPACE_FILE}`);

function readOnly(): Pick<RawFiles, 'writeText' | 'writeBlob' | 'removeDir'> {
  return {
    async writeText() {
      throw new Error('Read-only');
    },
    async writeBlob() {
      throw new Error('Read-only');
    },
    async removeDir() {
      throw new Error('Read-only');
    },
  };
}

const fetchReads: Pick<RawFiles, 'readText' | 'readBlob'> = {
  async readText(file) {
    const res = await fetchOrNull(dataUrl(file));
    if (!res) return null;
    const text = await res.text();
    // A dev server or host may answer unknown paths with index.html.
    return /^\s*<(!doctype|html)/i.test(text) ? null : text;
  },
  async readBlob(file) {
    const res = await fetchOrNull(dataUrl(file));
    return res ? res.blob() : null;
  },
};

export async function detectDevServer(): Promise<FileTarget | null> {
  if (!import.meta.env.DEV) return null;
  const res = await fetchOrNull(`${base()}__logbook/ping`);
  if (!res) return null;
  const info = (await res.json().catch(() => null)) as { ok?: boolean; dataDir?: string } | null;
  if (!info?.ok) return null;
  const dir = info.dataDir ?? 'data';
  const send = async (method: 'PUT' | 'DELETE', file: string, body?: BodyInit, headers?: Record<string, string>) => {
    const res = await fetch(`${base()}__logbook/file/${file.split('/').map(encodeURIComponent).join('/')}`, { method, body, headers });
    if (res.ok) return;
    const reason = await res
      .json()
      .then((j: { error?: string }) => j.error)
      .catch(() => null);
    throw new Error(`Could not ${method === 'PUT' ? 'write' : 'delete'} ${dir}/${file} (${reason ?? res.status})`);
  };
  return {
    kind: 'dev-server',
    label: targetLabel(dir),
    writable: true,
    ...codec({
      ...fetchReads,
      writeText: (file, text, headers) => send('PUT', file, text, headers),
      writeBlob: (file, blob) => send('PUT', file, blob),
      removeDir: (path) => send('DELETE', path),
    }),
  };
}

export function staticTarget(): FileTarget {
  return {
    kind: 'static',
    label: 'this browser',
    writable: false,
    ...codec({ ...fetchReads, ...readOnly() }),
  };
}

export function isFolderAccessSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

/** Ask the user for a folder. Picking the repo root is fine: its data/ folder is used. */
export async function pickDataFolder(): Promise<FileSystemDirectoryHandle> {
  if (!window.showDirectoryPicker) throw new Error('This browser cannot write to folders. Use Chrome or Edge, or run `npm run dev`.');
  const dir = await window.showDirectoryPicker({ id: 'logbook-data', mode: 'readwrite' });
  if (dir.name === 'data') return dir;
  try {
    return await dir.getDirectoryHandle('data');
  } catch {
    try {
      await dir.getFileHandle('package.json');
      return await dir.getDirectoryHandle('data', { create: true });
    } catch {
      return dir;
    }
  }
}

export async function folderPermission(dir: FileSystemDirectoryHandle, ask: boolean): Promise<PermissionState> {
  const opts = { mode: 'readwrite' as const };
  if (!dir.queryPermission) return 'granted';
  const state = await dir.queryPermission(opts);
  if (state === 'granted' || !ask || !dir.requestPermission) return state;
  return dir.requestPermission(opts);
}

export function folderTarget(dir: FileSystemDirectoryHandle): FileTarget {
  /** The folder holding a path like "assets/x.png", and the file name. */
  const locate = async (file: string, create: boolean) => {
    const parts = file.split('/');
    let folder = dir;
    for (const part of parts.slice(0, -1)) folder = await folder.getDirectoryHandle(part, { create });
    return { folder, name: parts[parts.length - 1] };
  };
  const read = async (file: string) => {
    try {
      const { folder, name } = await locate(file, false);
      return await (await folder.getFileHandle(name)).getFile();
    } catch {
      return null;
    }
  };
  const write = async (file: string, data: Blob | string) => {
    const { folder, name } = await locate(file, true);
    const stream = await (await folder.getFileHandle(name, { create: true })).createWritable();
    await stream.write(data);
    await stream.close();
  };
  return {
    kind: 'folder',
    label: targetLabel(dir.name),
    writable: true,
    ...codec({
      readText: async (file) => (await read(file))?.text() ?? null,
      readBlob: read,
      writeText: write,
      writeBlob: write,
      async removeDir(path) {
        try {
          const { folder, name } = await locate(path, false);
          await folder.removeEntry(name, { recursive: true });
        } catch (e) {
          if ((e as Error).name !== 'NotFoundError') throw e; // already gone
        }
      },
    }),
  };
}

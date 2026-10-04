/**
 * Where data/logbook.json lives, depending on how the app is being run:
 *
 *  - dev-server  `npm run dev`: the Vite plugin writes straight into the repo's data/ folder.
 *  - folder      deployed site in Chrome/Edge: you pick the repo's data/ folder once and the app writes there.
 *  - static      deployed site, read-only: shows the log book that was committed when the site was built.
 *
 * When the log book is locked (see src/data/sealed.ts) the same targets read and write the
 * encrypted files instead, using the key from the login page. Nothing leaves the browser unencrypted.
 */
import { decryptBytes, ENC_SUFFIX, encryptBytes } from '../lib/lock.ts';
import { mimeForAsset, openWorkspaceText, SEALED_WORKSPACE_FILE, sealWorkspaceText, WORKSPACE_FILE } from './sealed.ts';

export type TargetKind = 'dev-server' | 'folder' | 'static';

export interface FileTarget {
  kind: TargetKind;
  /** Shown in the "Last saved" indicator. */
  label: string;
  writable: boolean;
  readWorkspace(): Promise<string | null>;
  writeWorkspace(text: string): Promise<void>;
  readAsset(file: string): Promise<Blob | null>;
  writeAsset(file: string, blob: Blob): Promise<void>;
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

/** Set by the login page when the log book is locked. */
let dataKey: CryptoKey | null = null;
export function setDataKey(key: CryptoKey | null) {
  dataKey = key;
}

const workspaceFile = () => (dataKey ? SEALED_WORKSPACE_FILE : WORKSPACE_FILE);

/** Plain file access inside data/ (paths like "logbook.json" or "assets/x.png"). */
interface RawFiles {
  readText(file: string): Promise<string | null>;
  readBlob(file: string): Promise<Blob | null>;
  writeText(file: string, text: string): Promise<void>;
  writeBlob(file: string, blob: Blob): Promise<void>;
}

/** The workspace and asset methods of a target, encrypting when the log book is locked. */
function codec(raw: RawFiles): Pick<FileTarget, 'readWorkspace' | 'writeWorkspace' | 'readAsset' | 'writeAsset'> {
  return {
    async readWorkspace() {
      const text = await raw.readText(workspaceFile());
      // Throws on a wrong key, so a save never overwrites a file it could not read.
      return text !== null && dataKey ? openWorkspaceText(dataKey, text) : text;
    },
    async writeWorkspace(text) {
      await raw.writeText(workspaceFile(), dataKey ? await sealWorkspaceText(dataKey, text) : text);
    },
    async readAsset(file) {
      if (!dataKey) return raw.readBlob(file);
      const blob = await raw.readBlob(file + ENC_SUFFIX);
      if (!blob) return null;
      return new Blob([await decryptBytes(dataKey, new Uint8Array(await blob.arrayBuffer()))], { type: mimeForAsset(file) });
    },
    async writeAsset(file, blob) {
      if (!dataKey) return raw.writeBlob(file, blob);
      await raw.writeBlob(file + ENC_SUFFIX, new Blob([await encryptBytes(dataKey, new Uint8Array(await blob.arrayBuffer()))]));
    },
  };
}

function readOnly(): Pick<RawFiles, 'writeText' | 'writeBlob'> {
  return {
    async writeText() {
      throw new Error('Read-only');
    },
    async writeBlob() {
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
  const put = async (path: string, body: BodyInit, file: string) => {
    const res = await fetch(`${base()}__logbook/${path}`, { method: 'PUT', body });
    if (!res.ok) throw new Error(`Could not write ${dir}/${file} (${res.status})`);
  };
  return {
    kind: 'dev-server',
    label: `${dir}/${workspaceFile()}`,
    writable: true,
    ...codec({
      ...fetchReads,
      writeText: (file, text) => put(file === SEALED_WORKSPACE_FILE ? 'save-sealed' : 'save', text, file),
      writeBlob: (file, blob) => put(`asset/${encodeURIComponent(file.replace(/^assets\//, ''))}`, blob, file),
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
    label: `${dir.name}/${workspaceFile()}`,
    writable: true,
    ...codec({
      readText: async (file) => (await read(file))?.text() ?? null,
      readBlob: read,
      writeText: write,
      writeBlob: write,
    }),
  };
}

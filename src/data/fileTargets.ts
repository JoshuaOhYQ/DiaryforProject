/**
 * Where data/logbook.json lives, depending on how the app is being run:
 *
 *  - dev-server  `npm run dev`: the Vite plugin writes straight into the repo's data/ folder.
 *  - folder      deployed site in Chrome/Edge: you pick the repo's data/ folder once and the app writes there.
 *  - static      deployed site, read-only: shows the log book that was committed when the site was built.
 */
import { decryptBytes, ENC_SUFFIX } from '../lib/lock.ts';

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

/** Set after the login page unlocks a password-protected site; the published files are then `.enc`. */
let dataKey: CryptoKey | null = null;
export function setDataKey(key: CryptoKey | null) {
  dataKey = key;
}

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
};

async function fetchDecrypted(file: string): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!dataKey) return null;
  const res = await fetchOrNull(dataUrl(file + ENC_SUFFIX));
  if (!res) return null;
  return decryptBytes(dataKey, new Uint8Array(await res.arrayBuffer())).catch(() => null);
}

function staticReads() {
  return {
    async readWorkspace() {
      if (dataKey) {
        const bytes = await fetchDecrypted('logbook.json');
        return bytes ? new TextDecoder().decode(bytes) : null;
      }
      const res = await fetchOrNull(dataUrl('logbook.json'));
      if (!res) return null;
      const text = await res.text();
      // A dev server or host may answer unknown paths with index.html.
      return text.trimStart().startsWith('{') ? text : null;
    },
    async readAsset(file: string) {
      if (dataKey) {
        const bytes = await fetchDecrypted(file);
        const ext = file.split('.').pop()?.toLowerCase() ?? '';
        return bytes ? new Blob([bytes], { type: MIME[ext] ?? 'application/octet-stream' }) : null;
      }
      const res = await fetchOrNull(dataUrl(file));
      return res ? res.blob() : null;
    },
  };
}

export async function detectDevServer(): Promise<FileTarget | null> {
  if (!import.meta.env.DEV) return null;
  const res = await fetchOrNull(`${base()}__logbook/ping`);
  if (!res) return null;
  const info = (await res.json().catch(() => null)) as { ok?: boolean; dataDir?: string } | null;
  if (!info?.ok) return null;
  const dir = info.dataDir ?? 'data';
  return {
    kind: 'dev-server',
    label: `${dir}/logbook.json`,
    writable: true,
    ...staticReads(),
    async writeWorkspace(text) {
      const res = await fetch(`${base()}__logbook/save`, { method: 'PUT', body: text, headers: { 'Content-Type': 'application/json' } });
      if (!res.ok) throw new Error(`Could not write ${dir}/logbook.json (${res.status})`);
    },
    async writeAsset(file, blob) {
      const name = file.replace(/^assets\//, '');
      const res = await fetch(`${base()}__logbook/asset/${encodeURIComponent(name)}`, { method: 'PUT', body: blob });
      if (!res.ok) throw new Error(`Could not write ${dir}/${file} (${res.status})`);
    },
  };
}

export function staticTarget(): FileTarget {
  return {
    kind: 'static',
    label: 'this browser',
    writable: false,
    ...staticReads(),
    async writeWorkspace() {
      throw new Error('Read-only');
    },
    async writeAsset() {
      throw new Error('Read-only');
    },
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
  const writeFile = async (folder: FileSystemDirectoryHandle, name: string, data: Blob | string) => {
    const handle = await folder.getFileHandle(name, { create: true });
    const stream = await handle.createWritable();
    await stream.write(data);
    await stream.close();
  };
  return {
    kind: 'folder',
    label: `${dir.name}/logbook.json`,
    writable: true,
    async readWorkspace() {
      try {
        const file = await (await dir.getFileHandle('logbook.json')).getFile();
        return await file.text();
      } catch {
        return null;
      }
    },
    async writeWorkspace(text) {
      await writeFile(dir, 'logbook.json', text);
    },
    async readAsset(file) {
      try {
        const assets = await dir.getDirectoryHandle('assets');
        return await (await assets.getFileHandle(file.replace(/^assets\//, ''))).getFile();
      } catch {
        return null;
      }
    },
    async writeAsset(file, blob) {
      const assets = await dir.getDirectoryHandle('assets', { create: true });
      await writeFile(assets, file.replace(/^assets\//, ''), blob);
    },
  };
}

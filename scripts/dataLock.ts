/**
 * Node helpers for a locked data/ folder (see src/data/sealed.ts): find the password and
 * read or write the encrypted log book. Used by the dev server, the Git merge driver and scripts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { LOCK_FILE, unlock, type LockInfo } from '../src/lib/lock.ts';
import { openWorkspaceText, SEALED_WORKSPACE_FILE, sealWorkspaceText, WORKSPACE_FILE } from '../src/data/sealed.ts';

export const repoRoot = path.resolve(import.meta.dirname, '..');
export const dataDir = path.join(repoRoot, 'data');

/** LOGBOOK_PASSWORD from the environment, or from .env.local / .env in the repo (never committed). */
export function readPassword(name = 'LOGBOOK_PASSWORD'): string | undefined {
  for (const file of ['.env.local', '.env']) {
    if (process.env[name]) break;
    try {
      process.loadEnvFile(path.join(repoRoot, file));
    } catch {
      /* no such file */
    }
  }
  return process.env[name] || undefined;
}

export function readLock(dir = dataDir): LockInfo | null {
  const file = path.join(dir, LOCK_FILE);
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as LockInfo) : null;
}

export const isLocked = (dir = dataDir) => fs.existsSync(path.join(dir, LOCK_FILE));

/** The key for a locked data/ folder. Throws with a helpful message if the password is missing or wrong. */
export async function dataKey(dir = dataDir, password = readPassword()): Promise<CryptoKey> {
  const info = readLock(dir);
  if (!info) throw new Error(`${path.relative(repoRoot, dir)}/${LOCK_FILE} not found: the log book is not locked.`);
  if (!password) throw new Error('The log book is encrypted. Put LOGBOOK_PASSWORD=<the team password> in .env.local.');
  const key = await unlock(info, password);
  if (!key) throw new Error('LOGBOOK_PASSWORD does not match data/lock.json.');
  return key;
}

/** The log book JSON (plain or decrypted), or null if there is none yet. */
export async function readWorkspaceFile(dir = dataDir, key?: CryptoKey): Promise<string | null> {
  if (key) {
    const file = path.join(dir, SEALED_WORKSPACE_FILE);
    return fs.existsSync(file) ? openWorkspaceText(key, fs.readFileSync(file, 'utf8')) : null;
  }
  const file = path.join(dir, WORKSPACE_FILE);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}

export async function writeWorkspaceFile(json: string, dir = dataDir, key?: CryptoKey): Promise<string> {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, key ? SEALED_WORKSPACE_FILE : WORKSPACE_FILE);
  fs.writeFileSync(file, key ? await sealWorkspaceText(key, json) : json);
  return file;
}

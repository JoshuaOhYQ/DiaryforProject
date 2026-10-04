/**
 * Node helpers for a locked data/ folder (see src/data/sealed.ts): find the project passwords and
 * read or write each project's encrypted log book. Used by the dev server, the Git merge driver and scripts.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Workspace } from '../src/types.ts';
import { isLegacyLock, isLockInfo, LOCK_FILE, unlockProjects, type LegacyLockInfo, type LockInfo, type ProjectKeys } from '../src/lib/lock.ts';
import { openWorkspaceText, projectWorkspacePath, sealWorkspaceText, WORKSPACE_FILE } from '../src/data/sealed.ts';
import { serializeWorkspace } from '../src/data/workspace.ts';

export const repoRoot = path.resolve(import.meta.dirname, '..');
export const dataDir = path.join(repoRoot, 'data');

const PASSWORD_VAR = /^LOGBOOK_PASSWORD(_\w+)?$/;

function loadEnvFiles() {
  for (const file of ['.env.local', '.env']) {
    try {
      process.loadEnvFile(path.join(repoRoot, file)); // never overrides variables that are already set
    } catch {
      /* no such file */
    }
  }
}

/** One variable from the environment, or from .env.local / .env in the repo (never committed). */
export function readPassword(name: string): string | undefined {
  loadEnvFiles();
  return process.env[name] || undefined;
}

/**
 * Every project password this computer knows: LOGBOOK_PASSWORD and any LOGBOOK_PASSWORD_<NAME>
 * (e.g. LOGBOOK_PASSWORD_PIPER), from the environment or .env.local / .env.
 */
export function readPasswords(): string[] {
  loadEnvFiles();
  const out = Object.entries(process.env)
    .filter(([name, value]) => PASSWORD_VAR.test(name) && value)
    .map(([, value]) => value!);
  return [...new Set(out)];
}

export function readLock(dir = dataDir): LockInfo | LegacyLockInfo | null {
  const file = path.join(dir, LOCK_FILE);
  if (!fs.existsSync(file)) return null;
  const info: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (isLockInfo(info) || isLegacyLock(info)) return info;
  throw new Error(`${path.relative(repoRoot, file)} is not a log book lock.`);
}

export const isLocked = (dir = dataDir) => fs.existsSync(path.join(dir, LOCK_FILE));

/** The lock, refusing the old single-password format with a helpful message. */
export function readCurrentLock(dir = dataDir): LockInfo {
  const info = readLock(dir);
  if (!info) throw new Error(`${path.relative(repoRoot, dir)}/${LOCK_FILE} not found: the log book is not locked.`);
  if (info.v !== 2) throw new Error('data/lock.json still uses one password for every project. Run `npm run lock` to give each project its own.');
  return info;
}

/** The data keys of every project that a password in the environment / .env.local opens. */
export async function knownProjectKeys(info: LockInfo, passwords = readPasswords()): Promise<ProjectKeys> {
  const keys: ProjectKeys = new Map();
  for (const password of passwords) for (const [id, key] of await unlockProjects(info, password)) keys.set(id, key);
  return keys;
}

export const projectFile = (dir: string, projectId: string) => path.join(dir, ...projectWorkspacePath(projectId).split('/'));

/** A project's decrypted log book JSON, or null if it has no file yet. */
export async function readProjectFile(dir: string, projectId: string, key: CryptoKey): Promise<string | null> {
  const file = projectFile(dir, projectId);
  return fs.existsSync(file) ? openWorkspaceText(key, fs.readFileSync(file, 'utf8')) : null;
}

export async function writeProjectFile(dir: string, projectId: string, key: CryptoKey, ws: Workspace): Promise<string> {
  const file = projectFile(dir, projectId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, await sealWorkspaceText(key, serializeWorkspace(ws)));
  return file;
}

/** The plain log book JSON (data/logbook.json), or null if there is none. */
export function readWorkspaceFile(dir = dataDir): string | null {
  const file = path.join(dir, WORKSPACE_FILE);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}

export function writeWorkspaceFile(json: string, dir = dataDir): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, WORKSPACE_FILE);
  fs.writeFileSync(file, json);
  return file;
}

/** Which project each attachment file ("assets/x.png") belongs to, from the entries it is attached to. */
export function assetOwners(ws: Workspace): Map<string, string> {
  const owners = new Map<string, string>();
  for (const e of ws.entries) for (const a of e.attachments) owners.set(a.file, e.projectId);
  return owners;
}

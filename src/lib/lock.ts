/**
 * Per-project passwords for the encrypted log book.
 *
 * Every project has its own random data key, which encrypts that project's files (AES-256-GCM).
 * lock.json holds each data key wrapped (encrypted) with a key derived from that project's
 * password (PBKDF2), so a password opens only its own project. All projects share one salt, so
 * signing in derives a key once and then tries it on each project.
 *
 *   { "v": 2, "salt": "...", "iterations": 600000,
 *     "projects": { "<projectId>": { "key": "<wrapped data key>", "check": "<proves the data key>" } } }
 *
 * Uses Web Crypto only, so the same code runs in the browser and in Node (the Vite plugin, scripts).
 */
export interface ProjectLock {
  /** base64 of the project's data key, encrypted with its password key. */
  key: string;
  /** base64 of a known string encrypted with the data key, so a remembered key can be checked. */
  check: string;
}

export interface LockInfo {
  v: 2;
  /** base64 */
  salt: string;
  iterations: number;
  projects: Record<string, ProjectLock>;
}

/** The single-password lock used before per-project passwords; `npm run lock` upgrades it. */
export interface LegacyLockInfo {
  v: 1;
  salt: string;
  iterations: number;
  check: string;
}

/** Unlocked data keys by project id. */
export type ProjectKeys = Map<string, CryptoKey>;

export const LOCK_FILE = 'lock.json';
export const ENC_SUFFIX = '.enc';
const CHECK_TEXT = 'project-logbook';
const IV_BYTES = 12;
const ITERATIONS = 600_000;

const subtle = () => globalThis.crypto.subtle;

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function isLockInfo(x: unknown): x is LockInfo {
  const l = x as LockInfo | null;
  return l?.v === 2 && typeof l.salt === 'string' && !!l.projects && typeof l.projects === 'object';
}

export function isLegacyLock(x: unknown): x is LegacyLockInfo {
  const l = x as LegacyLockInfo | null;
  return l?.v === 1 && typeof l.salt === 'string' && typeof l.check === 'string';
}

async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const base = await subtle().importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ]);
}

/** Returns iv + ciphertext. */
export async function encryptBytes(key: CryptoKey, data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, key, data));
  const out = new Uint8Array(IV_BYTES + sealed.length);
  out.set(iv);
  out.set(sealed, IV_BYTES);
  return out;
}

/** Throws if the key is wrong or the data was tampered with. */
export async function decryptBytes(key: CryptoKey, data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const iv = data.slice(0, IV_BYTES);
  return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv }, key, data.slice(IV_BYTES)));
}

/** A lock with no projects yet. */
export function newLock(): LockInfo {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return { v: 2, salt: toBase64(salt), iterations: ITERATIONS, projects: {} };
}

/** The key a password gives in this lock (slow on purpose: PBKDF2). */
export function passwordKey(info: LockInfo, password: string): Promise<CryptoKey> {
  return deriveKey(password, fromBase64(info.salt), info.iterations);
}

/** A fresh random data key (for a new project, or when a project's password changes). */
export async function newDataKey(): Promise<CryptoKey> {
  return subtle().generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

const checkText = (projectId: string) => `${CHECK_TEXT}:${projectId}`;

/**
 * Give a project a password: returns the updated lock and the project's (new) data key.
 * Pass `password` as a string, or a key from passwordKey() to wrap several projects with one derivation.
 */
export async function setProjectPassword(
  info: LockInfo,
  projectId: string,
  password: string | CryptoKey,
  dataKey?: CryptoKey,
): Promise<{ info: LockInfo; key: CryptoKey }> {
  const wrapKey = typeof password === 'string' ? await passwordKey(info, password) : password;
  const key = dataKey ?? (await newDataKey());
  const raw = new Uint8Array(await subtle().exportKey('raw', key));
  const entry: ProjectLock = {
    key: toBase64(await encryptBytes(wrapKey, raw)),
    check: toBase64(await encryptBytes(key, new TextEncoder().encode(checkText(projectId)))),
  };
  return { info: { ...info, projects: { ...info.projects, [projectId]: entry } }, key };
}

/** The data keys of every project this password opens (empty if it opens none). */
export async function unlockProjects(info: LockInfo, password: string): Promise<ProjectKeys> {
  const wrapKey = await passwordKey(info, password);
  const keys: ProjectKeys = new Map();
  for (const [id, entry] of Object.entries(info.projects)) {
    try {
      const key = await importKey(toBase64(await decryptBytes(wrapKey, fromBase64(entry.key))));
      if (await checkProjectKey(info, id, key)) keys.set(id, key);
    } catch {
      /* a different project's password */
    }
  }
  return keys;
}

/** True if `key` is the current data key of the project (false after its password was changed). */
export async function checkProjectKey(info: LockInfo, projectId: string, key: CryptoKey): Promise<boolean> {
  const entry = info.projects[projectId];
  if (!entry) return false;
  try {
    return new TextDecoder().decode(await decryptBytes(key, fromBase64(entry.check))) === checkText(projectId);
  } catch {
    return false;
  }
}

/** The single key of an old v1 lock, or null if the password is wrong. Only used to upgrade. */
export async function unlockLegacy(info: LegacyLockInfo, password: string): Promise<CryptoKey | null> {
  const key = await deriveKey(password, fromBase64(info.salt), info.iterations);
  try {
    return new TextDecoder().decode(await decryptBytes(key, fromBase64(info.check))) === CHECK_TEXT ? key : null;
  } catch {
    return null;
  }
}

export async function exportKey(key: CryptoKey): Promise<string> {
  return toBase64(new Uint8Array(await subtle().exportKey('raw', key)));
}

export async function importKey(raw: string): Promise<CryptoKey> {
  return subtle().importKey('raw', fromBase64(raw), { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
}

/**
 * Password lock for the published site.
 *
 * At build time (LOGBOOK_PASSWORD set) every file in data/ is encrypted with AES-GCM using a
 * key derived from the password, and written as `<file>.enc` next to a `lock.json` that holds
 * the salt. The browser derives the same key on the login page and decrypts what it fetches.
 * Without the password the published files are unreadable, even when fetched directly.
 *
 * Uses Web Crypto only, so the same code runs in the browser and in Node (the Vite plugin).
 */
export interface LockInfo {
  v: 1;
  /** base64 */
  salt: string;
  iterations: number;
  /** base64 of an encrypted known string, so a wrong password is caught quickly. */
  check: string;
}

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

export async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
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

export async function createLock(password: string): Promise<{ info: LockInfo; key: CryptoKey }> {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(password, salt, ITERATIONS);
  const check = await encryptBytes(key, new TextEncoder().encode(CHECK_TEXT));
  return { info: { v: 1, salt: toBase64(salt), iterations: ITERATIONS, check: toBase64(check) }, key };
}

/** The key for this password, or null if the password is wrong. */
export async function unlock(info: LockInfo, password: string): Promise<CryptoKey | null> {
  const key = await deriveKey(password, fromBase64(info.salt), info.iterations);
  return (await checkKey(info, key)) ? key : null;
}

export async function checkKey(info: LockInfo, key: CryptoKey): Promise<boolean> {
  try {
    const text = new TextDecoder().decode(await decryptBytes(key, fromBase64(info.check)));
    return text === CHECK_TEXT;
  } catch {
    return false;
  }
}

export async function exportKey(key: CryptoKey): Promise<string> {
  return toBase64(new Uint8Array(await subtle().exportKey('raw', key)));
}

export async function importKey(raw: string): Promise<CryptoKey> {
  return subtle().importKey('raw', fromBase64(raw), { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
}

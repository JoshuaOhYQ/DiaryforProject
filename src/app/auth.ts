/**
 * Admin login for a site built with LOGBOOK_PASSWORD (see src/lib/lock.ts).
 *
 * The unlocked key is kept for the browser tab (sessionStorage), or on this device
 * (localStorage) when "Keep me signed in" is ticked. Logging out forgets it.
 */
import { setDataKey } from '../data/index.ts';
import { checkKey, exportKey, importKey, LOCK_FILE, type LockInfo } from '../lib/lock.ts';

const KEY_NAME = 'logbook.unlockKey';

let locked = false;

/** True when the site is password-protected (so a "Log out" button makes sense). */
export const isLockedSite = () => locked;

/** The site's lock, or null when the build isn't password-protected (e.g. `npm run dev`). */
export async function loadLock(): Promise<LockInfo | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL ?? '/'}data/${LOCK_FILE}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const info = (await res.json()) as LockInfo;
    locked = info?.v === 1 && typeof info.salt === 'string';
    return locked ? info : null;
  } catch {
    return null;
  }
}

function storages(): Storage[] {
  const out: Storage[] = [];
  try {
    out.push(sessionStorage, localStorage);
  } catch {
    /* storage blocked: the user just logs in each time */
  }
  return out;
}

/** Use a key saved by an earlier login, if it still opens this build. */
export async function restoreSession(info: LockInfo): Promise<boolean> {
  for (const s of storages()) {
    const raw = s.getItem(KEY_NAME);
    if (!raw) continue;
    const key = await importKey(raw).catch(() => null);
    if (key && (await checkKey(info, key))) {
      setDataKey(key);
      return true;
    }
    s.removeItem(KEY_NAME); // the password changed since
  }
  return false;
}

export async function startSession(key: CryptoKey, remember: boolean): Promise<void> {
  setDataKey(key);
  const raw = await exportKey(key);
  try {
    (remember ? localStorage : sessionStorage).setItem(KEY_NAME, raw);
  } catch {
    /* not remembered; works until the page is closed */
  }
}

export function logout(): void {
  for (const s of storages()) s.removeItem(KEY_NAME);
  location.reload();
}

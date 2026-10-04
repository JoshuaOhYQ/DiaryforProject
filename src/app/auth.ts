/**
 * Sign-in for a locked log book (see src/lib/lock.ts). Every project has its own password, and a
 * session holds the keys of the projects it has opened: signing in opens the chosen project, and
 * "Open another project" adds more. Creating a project needs the admin password.
 *
 * The keys are kept for the browser tab (sessionStorage), or on this device (localStorage) when
 * "Keep me signed in" is ticked. Logging out forgets them and removes the log book from this browser.
 */
import { getDataKeys, setDataKeys, store } from '../data/index.ts';
import {
  checkProjectKey,
  exportKey,
  importKey,
  isLegacyLock,
  isLockInfo,
  LOCK_FILE,
  setProjectName,
  setProjectPassword,
  unlockAdmin,
  unlockProjects,
  type LockInfo,
  type ProjectKeys,
} from '../lib/lock.ts';

const KEYS_NAME = 'logbook.projectKeys';

let locked = false;

/** True when the log book is password-protected (so "Log out" and per-project passwords make sense). */
export const isLockedSite = () => locked;

/**
 * The log book's lock: null when it isn't password-protected (e.g. a fresh `npm run dev`), or
 * 'outdated' for the old single-password lock that `npm run lock` upgrades.
 */
export async function loadLock(): Promise<LockInfo | 'outdated' | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL ?? '/'}data/${LOCK_FILE}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const info: unknown = await res.json();
    locked = isLockInfo(info);
    if (locked) return info as LockInfo;
    return isLegacyLock(info) ? 'outdated' : null;
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

/** True when the current keys are remembered on this device. */
function isRemembered(): boolean {
  try {
    return !!localStorage.getItem(KEYS_NAME);
  } catch {
    return false;
  }
}

/** Use keys saved by an earlier sign-in, keeping only those that still open their project. */
export async function restoreSession(info: LockInfo): Promise<boolean> {
  const keys: ProjectKeys = new Map();
  for (const s of storages()) {
    let saved: Record<string, string> = {};
    try {
      saved = JSON.parse(s.getItem(KEYS_NAME) ?? '{}') as Record<string, string>;
    } catch {
      /* damaged: ignore */
    }
    for (const [id, raw] of Object.entries(saved)) {
      const key = await importKey(raw).catch(() => null);
      // A key fails the check once that project's password has been changed.
      if (key && !keys.has(id) && (await checkProjectKey(info, id, key))) keys.set(id, key);
    }
  }
  if (!keys.size) {
    for (const s of storages()) s.removeItem(KEYS_NAME);
    return false;
  }
  await saveKeys(keys, isRemembered());
  return true;
}

async function saveKeys(keys: ProjectKeys, remember: boolean): Promise<void> {
  setDataKeys(keys);
  const raw: Record<string, string> = {};
  for (const [id, key] of keys) raw[id] = await exportKey(key);
  try {
    (remember ? sessionStorage : localStorage).removeItem(KEYS_NAME);
    (remember ? localStorage : sessionStorage).setItem(KEYS_NAME, JSON.stringify(raw));
  } catch {
    /* not remembered; works until the page is closed */
  }
}

/** Sign in with the keys a password opened (from the login page). */
export function startSession(keys: ProjectKeys, remember: boolean): Promise<void> {
  return saveKeys(keys, remember);
}

/** Add the projects another password opens to this session. */
export async function addToSession(keys: ProjectKeys): Promise<void> {
  await saveKeys(new Map([...(getDataKeys() ?? []), ...keys]), isRemembered());
}

/**
 * Give a new project its own password: saved in data/lock.json (which needs the admin key) and
 * opened in this session.
 */
export async function addProjectPassword(projectId: string, name: string, password: string, adminKey: CryptoKey): Promise<void> {
  let key: CryptoKey | null = null;
  await store.updateLock(async (info) => {
    if ((await unlockProjects(info, password)).size || (await unlockAdmin(info, password))) {
      throw new Error('That password is already used by another project or the admin. Choose a different one.');
    }
    const next = await setProjectPassword(info, projectId, password, { name });
    key = next.key;
    return next.info;
  }, { adminKey });
  await addToSession(new Map([[projectId, key!]]));
}

/** Keep the name on the sign-in page in step with a renamed project. Quietly does nothing when data/ can't be written. */
export async function syncProjectName(projectId: string, name: string): Promise<void> {
  const projectKey = getDataKeys()?.get(projectId);
  if (!locked || !projectKey || !store.canWriteFiles) return;
  await store.updateLock((info) => setProjectName(info, projectId, name), { projectKey }).catch(() => undefined);
}

export async function logout(): Promise<void> {
  for (const s of storages()) s.removeItem(KEYS_NAME);
  await store.clearLocalCopy();
  location.reload();
}

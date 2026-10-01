/**
 * Per-device preferences (theme, last author, zoom…) in localStorage.
 * These are conveniences only; the log book itself never lives here.
 */
export function getPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`logbook.${key}`);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function setPref(key: string, value: unknown): void {
  try {
    if (value === undefined || value === null) localStorage.removeItem(`logbook.${key}`);
    else localStorage.setItem(`logbook.${key}`, JSON.stringify(value));
  } catch {
    /* private mode or storage full: preferences just won't stick */
  }
}

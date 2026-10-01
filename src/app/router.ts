/**
 * A tiny hash router: "#/gantt?task=abc". Hash URLs work on GitHub Pages and from a
 * file:// copy with no server configuration.
 */
import { useSyncExternalStore } from 'react';

export interface Route {
  path: string;
  params: URLSearchParams;
}

type Params = Record<string, string | null | undefined>;

function read(): Route {
  const hash = window.location.hash.replace(/^#/, '') || '/';
  const [path, query = ''] = hash.split('?');
  return { path: path || '/', params: new URLSearchParams(query) };
}

let current = read();
const listeners = new Set<() => void>();
window.addEventListener('hashchange', () => {
  current = read();
  listeners.forEach((l) => l());
});

export function useRoute(): Route {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}

export function href(path: string, params: Params = {}): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  const q = qs.toString();
  return `#${path}${q ? `?${q}` : ''}`;
}

export function navigate(path: string, params: Params = {}, replace = false): void {
  const target = href(path, params);
  if (replace) {
    history.replaceState(null, '', target);
    current = read();
    listeners.forEach((l) => l());
  } else {
    window.location.hash = target.slice(1);
  }
}

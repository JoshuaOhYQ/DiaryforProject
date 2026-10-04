import { useEffect, useState, useSyncExternalStore } from 'react';

export type ThemeMode = 'system' | 'light' | 'dark';

const media = window.matchMedia('(prefers-color-scheme: dark)');
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
media.addEventListener('change', emit);

function readMode(): ThemeMode {
  try {
    const t = localStorage.getItem('logbook.theme');
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
}

let mode: ThemeMode = readMode();

export function setThemeMode(next: ThemeMode) {
  mode = next;
  try {
    if (next === 'system') localStorage.removeItem('logbook.theme');
    else localStorage.setItem('logbook.theme', next);
  } catch {
    /* ignore */
  }
  if (next === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', next);
  emit();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export function useThemeMode(): ThemeMode {
  return useSyncExternalStore(subscribe, () => mode);
}

/** The theme actually showing: 'light' or 'dark'. */
export function useResolvedTheme(): 'light' | 'dark' {
  return useSyncExternalStore(subscribe, () => (mode === 'system' ? (media.matches ? 'dark' : 'light') : mode));
}

export interface ThemeColors {
  bg: string;
  surface: string;
  surface2: string;
  surface3: string;
  border: string;
  borderStrong: string;
  /** Faint chart gridlines. */
  grid: string;
  text: string;
  text2: string;
  muted: string;
  accent: string;
  danger: string;
  warn: string;
  ok: string;
}

const VARS: Record<keyof ThemeColors, string> = {
  bg: '--bg',
  surface: '--surface',
  surface2: '--surface-2',
  surface3: '--surface-3',
  border: '--border',
  borderStrong: '--border-strong',
  grid: '--grid',
  text: '--text',
  text2: '--text-2',
  muted: '--muted',
  accent: '--accent',
  danger: '--danger',
  warn: '--warn',
  ok: '--ok',
};

/** Light-theme colours, used for exports (PNG, PDF) so they always print on white. */
export const LIGHT_COLORS: ThemeColors = {
  bg: '#ffffff',
  surface: '#ffffff',
  surface2: '#f1f3f6',
  surface3: '#e3e7ec',
  border: '#dde2e8',
  borderStrong: '#c3cbd4',
  grid: '#e6e9ee',
  text: '#1b2430',
  text2: '#445061',
  muted: '#687384',
  accent: '#2b6f8e',
  danger: '#b4423a',
  warn: '#9a6210',
  ok: '#2c7a4c',
};

function readColors(): ThemeColors {
  const style = getComputedStyle(document.documentElement);
  const out = { ...LIGHT_COLORS };
  for (const [k, v] of Object.entries(VARS) as [keyof ThemeColors, string][]) {
    const value = style.getPropertyValue(v).trim();
    if (value) out[k] = value;
  }
  return out;
}

/** Concrete colour values for drawing SVG charts that follow the current theme. */
export function useThemeColors(): ThemeColors {
  const theme = useResolvedTheme();
  const [colors, setColors] = useState(readColors);
  useEffect(() => setColors(readColors()), [theme]);
  return colors;
}

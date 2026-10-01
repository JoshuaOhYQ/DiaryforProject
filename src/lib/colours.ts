/**
 * Default colours for members and features. The order matters: neighbouring colours stay
 * distinguishable for colour-blind readers (checked with a CVD validator), so new members
 * and features take them in this order. Dark mode uses a matching step of each hue that
 * reads well on the dark background.
 */
export const PALETTE_LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
export const PALETTE_DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];

/** Grey for "no feature" / "unassigned". */
export const NEUTRAL = '#8a94a3';

const DARK_STEP = new Map(PALETTE_LIGHT.map((c, i) => [c, PALETTE_DARK[i]]));

/** The colour to draw with: palette colours switch to their dark step in dark mode; custom colours stay as chosen. */
export function displayColour(hex: string, theme: 'light' | 'dark'): string {
  return theme === 'dark' ? (DARK_STEP.get(hex.toLowerCase()) ?? hex) : hex;
}

/** The first palette colour not already used, so new items keep the safe order. */
export function nextColour(used: string[]): string {
  const taken = new Set(used.map((c) => c.toLowerCase()));
  return PALETTE_LIGHT.find((c) => !taken.has(c)) ?? PALETTE_LIGHT[used.length % PALETTE_LIGHT.length];
}

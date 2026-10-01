let lastMs = 0;
let seq = 0;

/**
 * Short ids like "mfz0abcd-00x7k2" that sort in creation order (time, then a counter for ids made
 * in the same millisecond, then randomness so two computers never clash).
 * Uses getRandomValues (not randomUUID) so it also works over plain http on a phone.
 */
export function newId(): string {
  const now = Date.now();
  if (now === lastMs) seq++;
  else [lastMs, seq] = [now, 0];
  const bytes = new Uint8Array(4);
  globalThis.crypto.getRandomValues(bytes);
  const random = Array.from(bytes, (b) => (b % 36).toString(36)).join('');
  return `${now.toString(36)}-${seq.toString(36).padStart(2, '0')}${random}`;
}

let lastStamp = 0;

/** ISO timestamp that always moves forward, even for two edits in the same millisecond. */
export function nowStamp(): string {
  const now = Math.max(Date.now(), lastStamp + 1);
  lastStamp = now;
  return new Date(now).toISOString();
}

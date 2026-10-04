/**
 * The encrypted form of data/ that is committed to Git when the log book is locked
 * (data/lock.json exists, see src/lib/lock.ts):
 *
 *   data/lock.json            salt and a password check (safe to publish)
 *   data/logbook.json.enc     one line of base64; a text line so a Git conflict still has
 *                             readable <<<<<<< ======= >>>>>>> markers around each side
 *   data/assets/<file>.enc    encrypted bytes
 *
 * Used by the app, the dev server, the Git merge driver and the scripts.
 */
import { decryptBytes, encryptBytes, ENC_SUFFIX, fromBase64, toBase64 } from '../lib/lock.ts';
import { splitConflictMarkers } from './merge.ts';

export const WORKSPACE_FILE = 'logbook.json';
export const SEALED_WORKSPACE_FILE = WORKSPACE_FILE + ENC_SUFFIX;

const CONFLICT_START = /^<{7}(\s|$)/m;
const SEALED_LINE = /^[A-Za-z0-9+/]+={0,2}$/;

/** True for text that looks like a sealed workspace (one base64 line), not JSON. */
export function looksSealed(text: string): boolean {
  return SEALED_LINE.test(text.trim());
}

export async function sealWorkspaceText(key: CryptoKey, json: string): Promise<string> {
  return toBase64(await encryptBytes(key, new TextEncoder().encode(json))) + '\n';
}

/**
 * Decrypt logbook.json.enc. If Git left conflict markers in it, both sides are decrypted and
 * returned between plain-text markers, which parseLogbookText() merges. Throws if the key is wrong.
 */
export async function openWorkspaceText(key: CryptoKey, sealed: string): Promise<string> {
  const open = async (line: string) => {
    if (!looksSealed(line)) throw new Error(`${SEALED_WORKSPACE_FILE} is damaged`);
    try {
      return new TextDecoder().decode(await decryptBytes(key, fromBase64(line.trim())));
    } catch {
      throw new Error(`Could not decrypt ${SEALED_WORKSPACE_FILE}. The password may have changed: log out and sign in again.`);
    }
  };
  if (!CONFLICT_START.test(sealed)) return open(sealed);
  const { ours, theirs } = splitConflictMarkers(sealed);
  return `<<<<<<< ours\n${await open(ours)}\n=======\n${await open(theirs)}\n>>>>>>> theirs\n`;
}

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
};

/** The type a decrypted asset had, from its file name (assets/<id>.<ext>). */
export function mimeForAsset(file: string): string {
  return MIME[file.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
}

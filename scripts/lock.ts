/**
 * Encrypt the log book in the repo, so it can be public on GitHub without anyone reading it.
 *
 *   npm run lock                  encrypt data/ with LOGBOOK_PASSWORD (the first run creates data/lock.json)
 *   npm run lock -- --rekey       change the password: LOGBOOK_PASSWORD = current, LOGBOOK_NEW_PASSWORD = new
 *   npm run lock -- --decrypt     turn encryption off again (plain data/logbook.json, no lock.json)
 *
 * Passwords are read from the environment or from .env.local (which Git ignores).
 * Encrypting only protects new commits: older commits still hold whatever was committed before.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createLock, decryptBytes, ENC_SUFFIX, encryptBytes, LOCK_FILE } from '../src/lib/lock.ts';
import { mergeWorkspaces, parseLogbookText } from '../src/data/merge.ts';
import { SEALED_WORKSPACE_FILE, WORKSPACE_FILE } from '../src/data/sealed.ts';
import { serializeWorkspace } from '../src/data/workspace.ts';
import { dataDir, dataKey, readPassword, readWorkspaceFile, repoRoot, writeWorkspaceFile } from './dataLock.ts';

const assetsDir = path.join(dataDir, 'assets');
const rel = (file: string) => path.relative(repoRoot, file).split(path.sep).join('/');

/** Asset files, either all plain ones or all encrypted ones. */
function assets(encrypted: boolean): string[] {
  if (!fs.existsSync(assetsDir)) return [];
  return fs
    .readdirSync(assetsDir)
    .filter((n) => !n.startsWith('.') && !n.endsWith('.tmp') && n.endsWith(ENC_SUFFIX) === encrypted)
    .map((n) => path.join(assetsDir, n));
}

/** One clean JSON text from any mix of plain, encrypted and conflicted copies. */
function combine(texts: (string | null)[]): string | null {
  const present = texts.filter((t): t is string => !!t?.trim());
  if (!present.length) return null;
  return serializeWorkspace(present.map(parseLogbookText).reduce((a, b) => mergeWorkspaces(a, b)));
}

function writeLock(info: object) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, LOCK_FILE), JSON.stringify(info, null, 2) + '\n');
}

async function encrypt() {
  const password = readPassword();
  if (!password) throw new Error('Put LOGBOOK_PASSWORD=<the team password> in .env.local first.');
  let key: CryptoKey;
  if (fs.existsSync(path.join(dataDir, LOCK_FILE))) {
    key = await dataKey();
  } else {
    const lock = await createLock(password);
    writeLock(lock.info);
    key = lock.key;
    console.log(`Created ${rel(path.join(dataDir, LOCK_FILE))}.`);
  }

  const plainFile = path.join(dataDir, WORKSPACE_FILE);
  const json = combine([await readWorkspaceFile(dataDir), await readWorkspaceFile(dataDir, key)]);
  if (json) {
    console.log(`Encrypted ${rel(await writeWorkspaceFile(json, dataDir, key))}.`);
    fs.rmSync(plainFile, { force: true });
  }
  for (const file of assets(false)) {
    fs.writeFileSync(file + ENC_SUFFIX, await encryptBytes(key, new Uint8Array(fs.readFileSync(file))));
    fs.rmSync(file);
    console.log(`Encrypted ${rel(file)}.`);
  }
  console.log('\nDone. Commit data/ (git add -A data). Only lock.json and .enc files should be in it.');
}

async function rekey() {
  const oldKey = await dataKey();
  const newPassword = readPassword('LOGBOOK_NEW_PASSWORD');
  if (!newPassword) throw new Error('Put LOGBOOK_NEW_PASSWORD=<new password> in .env.local (next to the current LOGBOOK_PASSWORD).');

  // Decrypt everything first, so a wrong file stops us before anything is rewritten.
  const json = combine([await readWorkspaceFile(dataDir, oldKey)]);
  const files = await Promise.all(assets(true).map(async (f) => ({ f, bytes: await decryptBytes(oldKey, new Uint8Array(fs.readFileSync(f))) })));

  const { info, key } = await createLock(newPassword);
  if (json) await writeWorkspaceFile(json, dataDir, key);
  for (const { f, bytes } of files) fs.writeFileSync(f, await encryptBytes(key, bytes));
  writeLock(info);
  console.log(`Re-encrypted the log book and ${files.length} attachment(s) with the new password.`);
  console.log('Now: set LOGBOOK_PASSWORD to the new password in .env.local (and remove LOGBOOK_NEW_PASSWORD),');
  console.log('commit data/, and tell the team. Everyone signs in again with the new password.');
}

async function decrypt() {
  const key = await dataKey();
  const json = combine([await readWorkspaceFile(dataDir, key)]);
  if (json) await writeWorkspaceFile(json, dataDir);
  for (const file of assets(true)) {
    fs.writeFileSync(file.slice(0, -ENC_SUFFIX.length), await decryptBytes(key, new Uint8Array(fs.readFileSync(file))));
    fs.rmSync(file);
  }
  fs.rmSync(path.join(dataDir, SEALED_WORKSPACE_FILE), { force: true });
  fs.rmSync(path.join(dataDir, LOCK_FILE));
  console.log('The log book is plain JSON again (data/logbook.json). Anyone who can see the repo can read it.');
}

const args = process.argv.slice(2);
try {
  await (args.includes('--rekey') ? rekey() : args.includes('--decrypt') ? decrypt() : encrypt());
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}

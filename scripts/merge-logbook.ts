/**
 * Git merge driver for data/logbook.json (and each project's encrypted data/projects/<id>/logbook.json.enc).
 *
 * When two people both add or edit entries, Git would normally report a conflict in the JSON.
 * This driver merges the two versions record by record instead (newest edit wins, deletions
 * are kept), using the same code as the app. Registered by scripts/setup-git.mjs.
 *
 * For an encrypted file it needs that project's password in .env.local (LOGBOOK_PASSWORD or
 * LOGBOOK_PASSWORD_<NAME>). Without it, it leaves both sides between conflict markers; the app
 * merges those when someone with the password next opens the project.
 *
 * Git runs:  node <this file> %O %A %B   (base, ours, theirs) and expects the result in %A.
 */
import fs from 'node:fs';
import { mergeWorkspaces, parseLogbookText } from '../src/data/merge.ts';
import { looksSealed, openWorkspaceText, sealWorkspaceText } from '../src/data/sealed.ts';
import { emptyWorkspace, serializeWorkspace } from '../src/data/workspace.ts';
import { knownProjectKeys, readCurrentLock } from './dataLock.ts';

const [, , , oursPath, theirsPath] = process.argv;
const ours = fs.readFileSync(oursPath, 'utf8');
const theirs = fs.readFileSync(theirsPath, 'utf8');
const sealed = looksSealed(ours) || looksSealed(theirs);

/** The project key that opens this file (Git doesn't say which project's file it is). */
async function findKey(): Promise<CryptoKey> {
  const sample = looksSealed(ours) ? ours : theirs;
  for (const key of (await knownProjectKeys(readCurrentLock())).values()) {
    if (await openWorkspaceText(key, sample).then(() => true, () => false)) return key;
  }
  throw new Error('None of the passwords in .env.local opens this project.');
}

try {
  const key = sealed ? await findKey() : null;
  const read = async (text: string) => {
    if (!text.trim()) return emptyWorkspace();
    return parseLogbookText(key ? await openWorkspaceText(key, text) : text);
  };
  const merged = serializeWorkspace(mergeWorkspaces(await read(ours), await read(theirs)));
  fs.writeFileSync(oursPath, key ? await sealWorkspaceText(key, merged) : merged);
} catch (e) {
  console.error(`logbook merge driver: ${(e as Error).message} Leaving a conflict; open the app to merge it.`);
  if (sealed) fs.writeFileSync(oursPath, `<<<<<<< ours\n${ours.trim()}\n=======\n${theirs.trim()}\n>>>>>>> theirs\n`);
  process.exit(1);
}

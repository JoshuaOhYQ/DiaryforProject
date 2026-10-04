/**
 * Git merge driver for data/logbook.json (and the encrypted data/logbook.json.enc).
 *
 * When two people both add or edit entries, Git would normally report a conflict in the JSON.
 * This driver merges the two versions record by record instead (newest edit wins, deletions
 * are kept), using the same code as the app. Registered by scripts/setup-git.mjs.
 *
 * For the encrypted file it needs LOGBOOK_PASSWORD (from .env.local). Without it, it leaves
 * both sides between conflict markers; the app merges those when it next opens the log book.
 *
 * Git runs:  node <this file> %O %A %B   (base, ours, theirs) and expects the result in %A.
 */
import fs from 'node:fs';
import { mergeWorkspaces, parseLogbookText } from '../src/data/merge.ts';
import { looksSealed, openWorkspaceText, sealWorkspaceText } from '../src/data/sealed.ts';
import { emptyWorkspace, serializeWorkspace } from '../src/data/workspace.ts';
import { dataKey } from './dataLock.ts';

const [, , , oursPath, theirsPath] = process.argv;
const ours = fs.readFileSync(oursPath, 'utf8');
const theirs = fs.readFileSync(theirsPath, 'utf8');
const sealed = looksSealed(ours) || looksSealed(theirs);

try {
  const key = sealed ? await dataKey() : null;
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

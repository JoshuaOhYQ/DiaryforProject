/**
 * Git merge driver for data/logbook.json.
 *
 * When two people both add or edit entries, Git would normally report a conflict in the JSON.
 * This driver merges the two versions record by record instead (newest edit wins, deletions
 * are kept), using the same code as the app. Registered by scripts/setup-git.mjs.
 *
 * Git runs:  node <this file> %O %A %B   (base, ours, theirs) and expects the result in %A.
 */
import fs from 'node:fs';
import { mergeWorkspaces, parseLogbookText } from '../src/data/merge.ts';
import { emptyWorkspace, serializeWorkspace } from '../src/data/workspace.ts';

const [, , , oursPath, theirsPath] = process.argv;

function read(file: string) {
  const text = fs.readFileSync(file, 'utf8');
  return text.trim() ? parseLogbookText(text) : emptyWorkspace();
}

try {
  const merged = mergeWorkspaces(read(oursPath), read(theirsPath));
  fs.writeFileSync(oursPath, serializeWorkspace(merged));
} catch (e) {
  console.error(`logbook merge driver: ${(e as Error).message}. Leaving a normal conflict for you to resolve.`);
  process.exit(1);
}

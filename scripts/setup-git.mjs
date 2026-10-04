// Runs on `npm install`. Registers the log book merge driver used by .gitattributes,
// so data/logbook.json (or each project's encrypted logbook.json.enc) is merged entry by entry instead of producing conflicts.
// Safe to run more than once; does nothing outside a Git checkout (e.g. on Vercel).
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

try {
  const top = git('rev-parse', '--show-toplevel');
  const driver = path.join(path.dirname(fileURLToPath(import.meta.url)), 'merge-logbook.ts');
  const relative = path.relative(top, driver).split(path.sep).join('/');
  git('config', 'merge.logbook.name', 'Project log book: merge entries by id');
  git('config', 'merge.logbook.driver', `node "${relative}" %O %A %B`);
  console.log('Git merge driver for data/logbook.json is set up.');
} catch {
  // Not a Git repository, or Git is not installed: nothing to do.
}

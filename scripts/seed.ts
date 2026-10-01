/**
 * Create data/logbook.json from a project template, optionally importing markdown work logs.
 *
 *   npm run seed                                   PIPER template + docs/WORK_LOG_smart_home.md
 *   npm run seed -- --template engineering         another template, no imports
 *   npm run seed -- --import docs/my-log.md        import a different log
 *   npm run seed -- --force                        overwrite an existing data/logbook.json
 *
 * Runs on plain Node (22.18 or newer understands TypeScript directly).
 */
import fs from 'node:fs';
import path from 'node:path';
import { applyChanges } from '../src/data/changes.ts';
import { emptyWorkspace, serializeWorkspace } from '../src/data/workspace.ts';
import { selectProject } from '../src/data/select.ts';
import { instantiateTemplate, TEMPLATES } from '../src/templates/index.ts';
import { parseMarkdownLog, toEntry } from '../src/import/markdownLog.ts';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'data', 'logbook.json');
const templateKey = option('template') ?? 'piper';
const imports = option('import') ? [option('import')!] : templateKey === 'piper' ? ['docs/WORK_LOG_smart_home.md'] : [];

if (fs.existsSync(out) && !flag('force')) {
  console.error(`${path.relative(root, out)} already exists. Use --force to overwrite it.`);
  process.exit(1);
}

const template = TEMPLATES.find((t) => t.key === templateKey);
if (!template) {
  console.error(`Unknown template "${templateKey}". Choose from: ${TEMPLATES.map((t) => t.key).join(', ')}`);
  process.exit(1);
}

const now = new Date().toISOString();
const { projectId, changes } = instantiateTemplate(template);
let ws = applyChanges(emptyWorkspace(), changes, now);
const data = selectProject(ws, projectId)!;

const entries = imports.flatMap((file) => {
  const parsed = parseMarkdownLog(fs.readFileSync(path.join(root, file), 'utf8'));
  for (const p of parsed) {
    if (p.warnings.length) console.log(`  ${file} (${p.date ?? 'no date'}): ${p.warnings.join(', ')}`);
  }
  return parsed.map((p) =>
    toEntry(p, {
      projectId,
      members: data.members,
      features: data.features,
      entryTypes: data.project.entryTypes,
      fallbackAuthorId: data.members[0]?.id ?? '',
    }),
  );
});

ws = applyChanges(ws, { put: { entries } }, now);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, serializeWorkspace(ws));
console.log(`Wrote ${path.relative(root, out)}: "${data.project.name}" with ${data.members.length} members, ${data.features.length} features, ${data.tasks.length} tasks, ${entries.length} imported entries.`);

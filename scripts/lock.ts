/**
 * Encrypt the log book in the repo, so it can be public on GitHub without anyone reading it.
 * Every project has its own password, so sharing one project's password shares only that project.
 *
 *   npm run lock                  encrypt data/: asks for a password for each project that has none yet,
 *                                 and for an admin password (needed to create projects) if there is none;
 *                                 also upgrades the old one-password lock, using LOGBOOK_PASSWORD
 *   npm run lock -- --password    change one project's password (asks for the current one, or the admin
 *                                 password if it is forgotten, then the new one)
 *   npm run lock -- --admin       change the admin password
 *   npm run lock -- --decrypt     turn encryption off again (plain data/logbook.json, no lock.json)
 *
 * Passwords are typed in the terminal. Known ones are also read from the environment or .env.local
 * (which Git ignores): LOGBOOK_PASSWORD / LOGBOOK_PASSWORD_<NAME> for projects, LOGBOOK_ADMIN_PASSWORD for the admin.
 * Encrypting only protects new commits: older commits still hold whatever was committed before.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Workspace } from '../src/types.ts';
import {
  decryptBytes,
  ENC_SUFFIX,
  encryptBytes,
  LOCK_FILE,
  addAdminCopy,
  listProjects,
  newLock,
  passwordKey,
  recoverProjectKey,
  setAdminPassword,
  setProjectName,
  setProjectPassword,
  unlockAdmin,
  unlockLegacy,
  unlockProject,
  unlockProjects,
  type LegacyLockInfo,
  type LockInfo,
  type ProjectKeys,
} from '../src/lib/lock.ts';
import { mergeWorkspaces, parseLogbookText } from '../src/data/merge.ts';
import { openWorkspaceText, PROJECTS_DIR, projectAssetPath, SEALED_WORKSPACE_FILE, WORKSPACE_FILE } from '../src/data/sealed.ts';
import { emptyWorkspace, projectIdsIn, projectSlice, serializeWorkspace } from '../src/data/workspace.ts';
import {
  assetOwners,
  dataDir,
  knownProjectKeys,
  readCurrentLock,
  readLock,
  readPassword,
  readPasswords,
  readProjectFile,
  readWorkspaceFile,
  repoRoot,
  writeProjectFile,
  writeWorkspaceFile,
} from './dataLock.ts';
import { ask, askNewPassword, closePrompt } from './prompt.ts';

const assetsDir = path.join(dataDir, 'assets');
const projectsDir = path.join(dataDir, PROJECTS_DIR);
const rel = (file: string) => path.relative(repoRoot, file).split(path.sep).join('/');
const inData = (relPath: string) => path.join(dataDir, ...relPath.split('/'));

/** Files in a folder, either all plain ones or all encrypted ones. */
function files(dir: string, encrypted: boolean): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((n) => !n.startsWith('.') && !n.endsWith('.tmp') && n.endsWith(ENC_SUFFIX) === encrypted)
    .map((n) => path.join(dir, n));
}

const merged = (list: Workspace[]) => list.reduce((a, b) => mergeWorkspaces(a, b), emptyWorkspace());

/** A name for a .env.local variable, e.g. LOGBOOK_PASSWORD_PIPER. */
function envName(projectName: string): string {
  const slug = projectName
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24)
    .replace(/_+$/, '');
  return `LOGBOOK_PASSWORD_${slug || 'PROJECT'}`;
}

/** Ask for an existing project's password until it opens that project (3 tries). */
async function askProjectKey(lock: LockInfo, id: string, name: string): Promise<CryptoKey> {
  for (let i = 0; i < 3; i++) {
    const key = (await unlockProjects(lock, await ask(`Password for "${name}": `, true))).get(id);
    if (key) return key;
    console.log('  That password does not open this project.');
  }
  throw new Error(`Could not open "${name}".`);
}

/** True if the password already belongs to a project or the admin in `lock`. */
async function inUse(lock: LockInfo, password: string): Promise<boolean> {
  return (await unlockProjects(lock, password)).size > 0 || !!(await unlockAdmin(lock, password));
}

/** Ask for a new password that no other project (nor the admin) in `lock` uses. */
async function askUniquePassword(lock: LockInfo, name: string): Promise<string> {
  for (;;) {
    const password = await askNewPassword(`"${name}"`);
    if (!(await inUse(lock, password))) return password;
    console.log('  That password is already used by another project or the admin. Choose a different one.');
  }
}

/** A new admin password: LOGBOOK_ADMIN_PASSWORD from .env.local (first time only), or typed in. */
async function askAdminPassword(lock: LockInfo, fromEnv: boolean): Promise<string> {
  const env = fromEnv ? readPassword('LOGBOOK_ADMIN_PASSWORD') : undefined;
  if (env) {
    if ((await unlockProjects(lock, env)).size) throw new Error('LOGBOOK_ADMIN_PASSWORD is also a project password. Use a different one for the admin.');
    console.log('Using LOGBOOK_ADMIN_PASSWORD from .env.local as the admin password.');
    return env;
  }
  console.log('The admin password creates projects and resets forgotten project passwords, so it can open every project. Keep it safe.');
  for (;;) {
    const password = await askNewPassword('the admin');
    if (!(await unlockProjects(lock, password)).size) return password;
    console.log('  That is a project password. Choose a different one for the admin.');
  }
}

let adminKeyCache: CryptoKey | null = null;

/** The admin key, from LOGBOOK_ADMIN_PASSWORD or typed in; null if skipped (Enter) or no admin password is set. */
async function adminKeyFor(lock: LockInfo, why: string): Promise<CryptoKey | null> {
  if (!lock.admin) return null;
  if (adminKeyCache) return adminKeyCache;
  const env = readPassword('LOGBOOK_ADMIN_PASSWORD');
  adminKeyCache = env ? await unlockAdmin(lock, env) : null;
  for (let i = 0; !adminKeyCache && i < 3; i++) {
    const password = await ask(`Admin password, ${why} (Enter to skip): `, true).catch(() => '');
    if (!password) return null;
    adminKeyCache = await unlockAdmin(lock, password);
    if (!adminKeyCache) console.log('  Wrong admin password.');
  }
  return adminKeyCache;
}

/**
 * Bring lock.json up to date: an admin password if there is none yet, each project's name for the
 * sign-in page (from `names`, or read from the projects this computer can open), and the admin's
 * copy of each project's key so the admin can reset forgotten passwords.
 */
async function finishLock(lock: LockInfo, keys: ProjectKeys, names: Map<string, string>): Promise<LockInfo> {
  if (!lock.admin) {
    const password = await askAdminPassword(lock, true);
    lock = await setAdminPassword(lock, password);
    adminKeyCache = await passwordKey(lock, password);
    console.log('Admin password set.');
  }
  const all = new Map([...(await knownProjectKeys(lock)), ...keys]);
  for (const id of Object.keys(lock.projects)) {
    const entry = lock.projects[id];
    if ((entry.name && entry.admin) || all.has(id)) continue;
    const password = await ask(
      `Password of "${entry.name ?? id}", to list its name and let the admin reset its password (Enter to skip): `,
      true,
    ).catch(() => '');
    if (!password) continue;
    const key = await unlockProject(lock, id, password);
    if (key) all.set(id, key);
    else console.log('  That is not this project’s password; skipped.');
  }
  for (const [id, key] of all) {
    if (!lock.projects[id]) continue;
    let name = names.get(id);
    if (name === undefined) {
      const json = await readProjectFile(dataDir, id, key).catch(() => null);
      name = json ? parseLogbookText(json).projects.find((p) => p.id === id)?.name : undefined;
    }
    if (name && name !== lock.projects[id].name) {
      lock = setProjectName(lock, id, name);
      console.log(`The sign-in page lists "${name}" (project names are public; everything inside stays encrypted).`);
    }
  }
  const noAdminCopy = [...all].filter(([id]) => lock.projects[id] && !lock.projects[id].admin);
  const adminKey = noAdminCopy.length ? await adminKeyFor(lock, 'so it can reset forgotten project passwords') : null;
  for (const [id, key] of adminKey ? noAdminCopy : []) {
    lock = await addAdminCopy(lock, id, key, adminKey!);
    console.log(`The admin password can now reset the password of "${lock.projects[id].name ?? id}".`);
  }
  return lock;
}

/** The key of the old one-password lock, from LOGBOOK_PASSWORD or typed in. */
async function legacyKey(lock: LegacyLockInfo): Promise<CryptoKey> {
  for (const password of readPasswords()) {
    const key = await unlockLegacy(lock, password);
    if (key) return key;
  }
  for (let i = 0; i < 3; i++) {
    const key = await unlockLegacy(lock, await ask('Current team password (the one used so far): ', true));
    if (key) return key;
    console.log('  Wrong password.');
  }
  throw new Error('Wrong team password.');
}

async function encrypt() {
  const existing = readLock();
  const legacy = existing?.v === 1 ? existing : null;
  let lock: LockInfo = existing?.v === 2 ? existing : newLock();

  // Everything not yet in a project's encrypted files: a plain logbook.json and plain screenshots,
  // or the files of the old one-password lock.
  const incoming: Workspace[] = [];
  const looseAssets = new Map<string, Uint8Array<ArrayBuffer>>(); // "assets/x.png" -> bytes
  const source = new Map<string, string>(); // "assets/x.png" -> file to remove once moved
  const oldFiles: string[] = [];

  const plain = readWorkspaceFile();
  if (plain?.trim()) incoming.push(parseLogbookText(plain));
  if (plain !== null) oldFiles.push(path.join(dataDir, WORKSPACE_FILE));
  for (const file of files(assetsDir, false)) {
    looseAssets.set(`assets/${path.basename(file)}`, new Uint8Array(fs.readFileSync(file)));
    source.set(`assets/${path.basename(file)}`, file);
  }
  if (legacy) {
    const oldKey = await legacyKey(legacy);
    const sealed = path.join(dataDir, SEALED_WORKSPACE_FILE);
    if (fs.existsSync(sealed)) {
      incoming.push(parseLogbookText(await openWorkspaceText(oldKey, fs.readFileSync(sealed, 'utf8'))));
      oldFiles.push(sealed);
    }
    for (const file of files(assetsDir, true)) {
      const name = `assets/${path.basename(file, ENC_SUFFIX)}`;
      looseAssets.set(name, await decryptBytes(oldKey, new Uint8Array(fs.readFileSync(file))));
      source.set(name, file);
    }
  }

  const ws = merged(incoming);
  const ids = projectIdsIn(ws);
  if (!existing && !ids.size) throw new Error('There is no log book to encrypt yet. Create a project first (npm run dev), then run this again.');
  if (existing?.v === 2 && !ids.size && !looseAssets.size) {
    const updated = await finishLock(lock, new Map(), new Map());
    if (JSON.stringify(updated) === JSON.stringify(lock)) {
      console.log('Everything in data/ is already encrypted. To change a password: npm run lock -- --password (or --admin)');
      return;
    }
    fs.writeFileSync(path.join(dataDir, LOCK_FILE), JSON.stringify(updated, null, 2) + '\n');
    console.log('\nUpdated data/lock.json. Commit it (git add data/lock.json).');
    return;
  }

  const names = new Map(ws.projects.map((p) => [p.id, p.name]));
  const nameOf = (id: string) => names.get(id) ?? `project ${id}`;
  const known = existing?.v === 2 ? await knownProjectKeys(lock) : new Map<string, CryptoKey>();
  const keys: ProjectKeys = new Map();
  const added: string[] = [];
  const keyFor = async (id: string) => {
    if (!keys.has(id)) keys.set(id, known.get(id) ?? (await askProjectKey(lock, id, nameOf(id))));
    return keys.get(id)!;
  };

  // Work out every project's new contents first; nothing is written until all passwords are in.
  const slices: { id: string; ws: Workspace }[] = [];
  for (const id of ids) {
    let slice = projectSlice(ws, id);
    if (lock.projects[id]) {
      const current = await readProjectFile(dataDir, id, await keyFor(id));
      if (current) slice = mergeWorkspaces(parseLogbookText(current), slice);
    } else {
      if (!added.length) console.log('Each project gets its own password. Only people with a project’s password can open it.\n');
      const next = await setProjectPassword(lock, id, await askUniquePassword(lock, nameOf(id)), { name: nameOf(id) });
      lock = next.info;
      keys.set(id, next.key);
      added.push(id);
    }
    slices.push({ id, ws: slice });
  }

  const sliceNames = new Map(slices.flatMap((s) => s.ws.projects.filter((p) => p.id === s.id).map((p) => [s.id, p.name] as const)));
  lock = await finishLock(lock, keys, sliceNames);

  // Screenshots go to the project of the entry they are attached to.
  const owners = assetOwners(merged([ws, ...slices.map((s) => s.ws)]));
  const assets: { file: string; id: string; bytes: Uint8Array<ArrayBuffer> }[] = [];
  const unowned: string[] = [];
  for (const [file, bytes] of looseAssets) {
    const id = owners.get(file);
    if (id && lock.projects[id]) assets.push({ file, id, bytes: await encryptBytes(await keyFor(id), bytes) });
    else unowned.push(file);
  }

  for (const s of slices) console.log(`Encrypted ${rel(await writeProjectFile(dataDir, s.id, keys.get(s.id)!, s.ws))} ("${nameOf(s.id)}").`);
  for (const a of assets) {
    const out = inData(projectAssetPath(a.id, a.file));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, a.bytes);
  }
  if (assets.length) console.log(`Encrypted ${assets.length} screenshot(s) into their projects' folders.`);
  fs.writeFileSync(path.join(dataDir, LOCK_FILE), JSON.stringify(lock, null, 2) + '\n');
  for (const file of oldFiles) fs.rmSync(file, { force: true });
  for (const a of assets) fs.rmSync(source.get(a.file)!, { force: true });
  for (const file of unowned) console.log(`Left ${rel(source.get(file)!)} where it is: no entry uses it.`);

  console.log('\nDone. Commit data/ (git add -A data): lock.json and the .enc files under data/projects/.');
  // Only mention passwords .env.local doesn't already hold.
  const inEnv = await knownProjectKeys(lock);
  const missing = added.filter((id) => !inEnv.has(id));
  if (missing.length) {
    console.log('\nSo Git can merge teammates’ entries, add the password(s) to .env.local (never commit it), e.g.:');
    for (const id of missing) console.log(`  ${envName(nameOf(id))}=<the password of "${nameOf(id)}">`);
  }
  if (added.length) console.log('\nGive each project’s password only to the people who should see that project.');
  if (legacy) {
    console.log('\nThe old team password still opens every commit made before this one: share only the new project passwords from now on.');
    const old = readPassword('LOGBOOK_PASSWORD');
    if (old && !(await unlockProjects(lock, old)).size) console.log('LOGBOOK_PASSWORD in .env.local is no longer a project password; you can delete that line.');
  }
}

async function changePassword() {
  const lock = readCurrentLock();
  const current = await ask('Current password of the project (Enter if forgotten, to use the admin password): ', true);
  let opened: ProjectKeys;
  if (current) {
    opened = await unlockProjects(lock, current);
    if (!opened.size) throw new Error('That password does not open any project.');
  } else {
    const adminKey = await adminKeyFor(lock, 'to reset a forgotten project password');
    if (!adminKey) throw new Error('Without the project’s current password, the admin password is needed.');
    const resettable = listProjects(lock).filter((p) => lock.projects[p.id].admin);
    if (!resettable.length) throw new Error('No project has an admin copy of its key yet. Run `npm run lock` with the project passwords first.');
    resettable.forEach((p, i) => console.log(`  ${i + 1}. ${p.name}`));
    const n = resettable.length === 1 ? 1 : Number(await ask(`Which project gets a new password? (1-${resettable.length}) `));
    const chosenId = resettable[n - 1]?.id;
    const key = chosenId ? await recoverProjectKey(lock, chosenId, adminKey) : null;
    if (!key) throw new Error('No such project.');
    opened = new Map([[chosenId, key]]);
  }

  const projects: { id: string; key: CryptoKey; ws: Workspace | null; name: string }[] = [];
  for (const [id, key] of opened) {
    const json = await readProjectFile(dataDir, id, key);
    const ws = json ? parseLogbookText(json) : null;
    projects.push({ id, key, ws, name: ws?.projects.find((p) => p.id === id)?.name ?? `project ${id}` });
  }
  let chosen = projects[0];
  if (projects.length > 1) {
    projects.forEach((p, i) => console.log(`  ${i + 1}. ${p.name}`));
    const n = Number(await ask(`This password opens ${projects.length} projects. Which one gets a new password? (1-${projects.length}) `));
    chosen = projects[n - 1];
    if (!chosen) throw new Error('No such project.');
  }

  // Decrypt everything first, so a damaged file stops us before anything is rewritten.
  const assetDir = path.join(projectsDir, chosen.id, 'assets');
  const assets = await Promise.all(
    files(assetDir, true).map(async (f) => ({ f, bytes: await decryptBytes(chosen.key, new Uint8Array(fs.readFileSync(f))) })),
  );
  const others: LockInfo = { ...lock, projects: Object.fromEntries(Object.entries(lock.projects).filter(([id]) => id !== chosen.id)) };
  const password = await askUniquePassword(others, chosen.name);

  // A new data key too, so someone who kept the old key (not just the password) is locked out.
  // The admin's copy is made again for the new key, if the admin password is at hand.
  const adminKey = await adminKeyFor(lock, 'so it can still reset this project’s password later');
  if (lock.admin && !adminKey) console.log('  Skipped: the admin password cannot reset this project’s password until `npm run lock` is run with it.');
  const { info, key } = await setProjectPassword(lock, chosen.id, password, { adminKey: adminKey ?? undefined });
  if (chosen.ws) await writeProjectFile(dataDir, chosen.id, key, chosen.ws);
  for (const { f, bytes } of assets) fs.writeFileSync(f, await encryptBytes(key, bytes));
  fs.writeFileSync(path.join(dataDir, LOCK_FILE), JSON.stringify(info, null, 2) + '\n');
  console.log(`Re-encrypted "${chosen.name}" and ${assets.length} screenshot(s) with the new password.`);
  console.log(`Now: update ${envName(chosen.name)} (or whichever line held the old password) in .env.local,`);
  console.log('commit data/, and give the new password to the people on this project. Everyone signs in to it again.');
  console.log('Commits made before this one can still be opened with the old password.');
}

async function changeAdmin() {
  const lock = readCurrentLock();
  let currentKey: CryptoKey | null = null;
  if (lock.admin) {
    const env = readPassword('LOGBOOK_ADMIN_PASSWORD');
    currentKey = env ? await unlockAdmin(lock, env) : null;
    for (let i = 0; !currentKey && i < 3; i++) {
      currentKey = await unlockAdmin(lock, await ask('Current admin password: ', true));
      if (!currentKey) console.log('  Wrong admin password.');
    }
    if (!currentKey) {
      throw new Error('Wrong admin password. (If it is lost, delete the "admin" block and every project\'s "admin" line from data/lock.json, then run npm run lock.)');
    }
  }
  // The admin's copies of the project keys move over to the new admin password.
  const info = await setAdminPassword(lock, await askAdminPassword(lock, false), currentKey ?? undefined);
  fs.writeFileSync(path.join(dataDir, LOCK_FILE), JSON.stringify(info, null, 2) + '\n');
  console.log('Admin password changed. Update LOGBOOK_ADMIN_PASSWORD in .env.local if you keep it there, and commit data/lock.json.');
}

async function decrypt() {
  const lock = readCurrentLock();
  const keys = await knownProjectKeys(lock);
  for (const id of Object.keys(lock.projects)) {
    if (keys.has(id)) continue;
    const password = await ask(`Password for project ${id}: `, true);
    const opened = await unlockProjects(lock, password);
    if (!opened.has(id)) throw new Error('That password does not open this project.');
    for (const [i, k] of opened) keys.set(i, k);
  }

  const parts: Workspace[] = [];
  const plain = readWorkspaceFile();
  if (plain?.trim()) parts.push(parseLogbookText(plain));
  const assets: { out: string; bytes: Uint8Array<ArrayBuffer> }[] = [];
  for (const [id, key] of keys) {
    const json = await readProjectFile(dataDir, id, key);
    if (json) parts.push(parseLogbookText(json));
    for (const f of files(path.join(projectsDir, id, 'assets'), true)) {
      assets.push({ out: path.join(assetsDir, path.basename(f, ENC_SUFFIX)), bytes: await decryptBytes(key, new Uint8Array(fs.readFileSync(f))) });
    }
  }

  writeWorkspaceFile(serializeWorkspace(merged(parts)));
  fs.mkdirSync(assetsDir, { recursive: true });
  for (const a of assets) fs.writeFileSync(a.out, a.bytes);
  fs.rmSync(projectsDir, { recursive: true, force: true });
  fs.rmSync(path.join(dataDir, LOCK_FILE));
  console.log('The log book is plain JSON again (data/logbook.json). Anyone who can see the repo can read it.');
}

const args = process.argv.slice(2);
try {
  if (args.includes('--rekey')) throw new Error('--rekey is now --password: every project has its own password.');
  await (args.includes('--password') ? changePassword() : args.includes('--admin') ? changeAdmin() : args.includes('--decrypt') ? decrypt() : encrypt());
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  closePrompt();
}

// LOGBOOK_NEW_PASSWORD belonged to the old --rekey; mention it so it doesn't linger in .env.local.
if (readPassword('LOGBOOK_NEW_PASSWORD')) console.log('\n(LOGBOOK_NEW_PASSWORD in .env.local is no longer used; you can delete it.)');

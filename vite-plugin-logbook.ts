/**
 * Dev-server helper that lets the browser app write straight into the repo's data/ folder.
 *
 *   GET  /data/...                    serve data/ (dev only; the build copies it)
 *   GET  /__logbook/ping              tells the app that file saving is available
 *   PUT  /__logbook/file/<path>       body = file contents -> data/<path>, for these paths only:
 *          logbook.json, assets/<name>                         a plain log book
 *          lock.json                                           a locked one: only new projects may be added
 *          projects/<id>/logbook.json.enc,
 *          projects/<id>/assets/<name>.enc                     a locked project's files
 *
 * This only exists while `npm run dev` is running, so the deployed site stays a static site.
 *
 * When data/lock.json exists the log book is encrypted in the repo, each project with its own key
 * (src/data/sealed.ts): the browser encrypts before saving, and this server refuses to read or
 * write plain files. For projects whose password is in .env.local (LOGBOOK_PASSWORD or
 * LOGBOOK_PASSWORD_<NAME>) it also checks that each write really uses that project's key.
 *
 * The build publishes a locked data/ folder as it is (encrypted). An unlocked one is published
 * plain, or encrypted on the fly when `password` is set (then that one password opens every project).
 */
import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { decryptBytes, encryptBytes, ENC_SUFFIX, isLockInfo, LOCK_FILE, newLock, passwordKey, setProjectPassword, type LockInfo, type ProjectKeys } from './src/lib/lock.ts';
import { parseLogbookText } from './src/data/merge.ts';
import { looksSealed, openWorkspaceText, PROJECTS_DIR, projectAssetPath, projectWorkspacePath, SEALED_WORKSPACE_FILE, sealWorkspaceText, WORKSPACE_FILE } from './src/data/sealed.ts';
import { projectIdsIn, projectSlice, serializeWorkspace } from './src/data/workspace.ts';
import { assetOwners, isLocked, knownProjectKeys, readCurrentLock, readLock, readWorkspaceFile } from './scripts/dataLock.ts';

interface Options {
  dataDir?: string;
  /** Copy data/ into the build so the deployed site shows the committed log book. */
  publishData?: boolean;
  /** Admin password for the published site. Without it, data/ is published as plain files. */
  password?: string;
}

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,150}$/;
const FILE_ROUTE = '/__logbook/file/';

/** A refused write, with the HTTP status to answer. */
class Refused extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** A new lock.json may only add projects: the salt and every existing project's entry must stay as they are. */
function checkLockUpdate(current: LockInfo, text: string) {
  let next: unknown;
  try {
    next = JSON.parse(text);
  } catch {
    throw new Refused(400, 'lock.json is not valid JSON');
  }
  if (!isLockInfo(next) || next.salt !== current.salt || next.iterations !== current.iterations) throw new Refused(400, 'Not an update of data/lock.json');
  for (const [id, entry] of Object.entries(current.projects)) {
    if (JSON.stringify(next.projects[id]) !== JSON.stringify(entry)) {
      throw new Refused(403, 'Project passwords are changed or removed with `npm run lock`, not from the app');
    }
  }
  for (const [id, entry] of Object.entries(next.projects)) {
    if (!SAFE_NAME.test(id) || typeof entry?.key !== 'string' || typeof entry?.check !== 'string') throw new Refused(400, 'Bad project entry in lock.json');
  }
}
const MAX_BODY = 60 * 1024 * 1024;

const MIME: Record<string, string> = {
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
};

export function logbookFiles(options: Options = {}): Plugin {
  const dataDirName = options.dataDir ?? 'data';
  let root = process.cwd();
  let outDir = path.resolve(root, 'dist');

  return {
    name: 'logbook-files',
    configResolved(config) {
      root = config.root;
      outDir = path.resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      const dataDir = path.resolve(root, dataDirName);

      // Keys of the projects whose password is in .env.local, re-read if lock.json changes.
      // Projects without a known password are saved unchecked.
      let cached: { lock: string; keys: Promise<ProjectKeys> } | null = null;
      let warned = false;
      const verifyKeys = () => {
        const lock = fs.readFileSync(path.join(dataDir, LOCK_FILE), 'utf8');
        if (cached?.lock !== lock) {
          cached = {
            lock,
            keys: knownProjectKeys(readCurrentLock(dataDir)).catch((e: Error) => {
              server.config.logger.warn(`[logbook] ${e.message}`);
              return new Map();
            }),
          };
        }
        return cached.keys;
      };

      /** Check a write to data/<rel>; returns the file to write or throws Refused. */
      const checkWrite = async (rel: string, body: Buffer): Promise<string> => {
        const parts = rel.split('/');
        const file = path.join(dataDir, ...parts);
        const locked = isLocked(dataDir);
        const plainAsset = parts.length === 2 && parts[0] === 'assets' && SAFE_NAME.test(parts[1]);
        if (rel === WORKSPACE_FILE || plainAsset) {
          if (locked) throw new Refused(403, 'The log book is encrypted. Sign in again.');
          if (rel === WORKSPACE_FILE) JSON.parse(body.toString('utf8')); // refuse anything that is not valid JSON
          return file;
        }
        if (!locked) throw new Refused(400, 'The log book is not encrypted');
        let lock: LockInfo;
        try {
          lock = readCurrentLock(dataDir);
        } catch (e) {
          throw new Refused(409, (e as Error).message);
        }
        if (rel === LOCK_FILE) {
          checkLockUpdate(lock, body.toString('utf8'));
          return file;
        }
        const [dir, id, ...rest] = parts;
        if (dir !== PROJECTS_DIR || !SAFE_NAME.test(id ?? '') || !lock.projects[id]) throw new Refused(404, 'Unknown project');
        const key = (await verifyKeys()).get(id);
        if (!key && !warned) {
          warned = true;
          server.config.logger.warn('[logbook] Some project passwords are not in .env.local, so saves to those projects are not checked.');
        }
        if (rest.length === 1 && rest[0] === SEALED_WORKSPACE_FILE) {
          const text = body.toString('utf8');
          if (!looksSealed(text)) throw new Refused(400, 'Not an encrypted log book');
          if (key && !(await openWorkspaceText(key, text).then(() => true, () => false))) throw new Refused(403, 'Wrong password for this project');
          return file;
        }
        if (rest.length === 2 && rest[0] === 'assets' && SAFE_NAME.test(rest[1]) && rest[1].endsWith(ENC_SUFFIX)) {
          if (key && !(await decryptBytes(key, new Uint8Array(body)).then(() => true, () => false))) throw new Refused(403, 'Wrong password for this project');
          return file;
        }
        throw new Refused(400, 'Not a log book file');
      };

      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const pathname = decodeURIComponent(url.pathname);

        if (pathname.startsWith('/__logbook/') && !isSameOrigin(req)) {
          return send(res, 403, { error: 'Cross-origin request refused' });
        }

        if (req.method === 'GET' && pathname === '/__logbook/ping') {
          return send(res, 200, { ok: true, dataDir: path.relative(root, dataDir) || '.' });
        }

        if (req.method === 'PUT' && pathname.startsWith(FILE_ROUTE)) {
          readBody(req)
            .then(async (body) => {
              const file = await checkWrite(pathname.slice(FILE_ROUTE.length), body);
              fs.mkdirSync(path.dirname(file), { recursive: true });
              writeAtomic(file, body);
              send(res, 200, { ok: true, savedAt: new Date().toISOString() });
            })
            .catch((err: Error) => send(res, err instanceof Refused ? err.status : 400, { error: err.message }));
          return;
        }

        if ((req.method === 'GET' || req.method === 'HEAD') && pathname.startsWith(`/${dataDirName}/`)) {
          const file = path.resolve(root, '.' + pathname);
          if (!file.startsWith(dataDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
            return send(res, 404, { error: 'Not found' });
          }
          // Once locked, never hand out a stray plain copy (e.g. to phones with `--host`).
          if (isLocked(dataDir) && !file.endsWith(ENC_SUFFIX) && path.basename(file) !== LOCK_FILE) {
            return send(res, 404, { error: 'Not found' });
          }
          res.statusCode = 200;
          res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream');
          res.setHeader('Cache-Control', 'no-store');
          if (req.method === 'HEAD') return res.end();
          return fs.createReadStream(file).pipe(res);
        }

        next();
      });
    },
    async closeBundle() {
      const src = path.resolve(root, dataDirName);
      const dest = path.join(outDir, dataDirName);
      if (isLocked(src)) {
        if (readLock(src)?.v !== 2) throw new Error('data/lock.json still uses one password for every project. Run `npm run lock`, then commit data/.');
        // Already encrypted in the repo: publish lock.json and the .enc files, nothing else.
        fs.cpSync(src, dest, {
          recursive: true,
          filter: (from) =>
            fs.statSync(from).isDirectory() || path.basename(from) === LOCK_FILE || (options.publishData !== false && from.endsWith(ENC_SUFFIX)),
        });
        return;
      }
      if (options.publishData === false || !fs.existsSync(src)) return;
      if (!options.password) {
        fs.cpSync(src, dest, { recursive: true });
        return;
      }
      // A plain data/ folder with LOGBOOK_PASSWORD: publish it encrypted, every project under that one password.
      const text = readWorkspaceFile(src);
      if (!text) return;
      const ws = parseLogbookText(text);
      let lock = newLock();
      const wrapKey = await passwordKey(lock, options.password);
      const keys: ProjectKeys = new Map();
      const write = (rel: string, data: string | Uint8Array) => {
        const out = path.join(dest, ...rel.split('/'));
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, data);
      };
      for (const id of projectIdsIn(ws)) {
        const next = await setProjectPassword(lock, id, wrapKey);
        lock = next.info;
        keys.set(id, next.key);
        write(projectWorkspacePath(id), await sealWorkspaceText(next.key, serializeWorkspace(projectSlice(ws, id))));
      }
      for (const [file, id] of assetOwners(ws)) {
        const from = path.join(src, ...file.split('/'));
        if (keys.has(id) && fs.existsSync(from)) write(projectAssetPath(id, file), await encryptBytes(keys.get(id)!, new Uint8Array(fs.readFileSync(from))));
      }
      write(LOCK_FILE, JSON.stringify(lock));
    },
  };
}

function isSameOrigin(req: IncomingMessage): boolean {
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('File too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** Write to a temp file then rename, so a crash never leaves a half-written logbook.json. */
function writeAtomic(file: string, data: Buffer) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  try {
    fs.renameSync(tmp, file);
  } catch {
    // Windows can refuse the rename while another program has the file open.
    fs.writeFileSync(file, data);
    fs.rmSync(tmp, { force: true });
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

/**
 * Dev-server helper that lets the browser app write straight into the repo's data/ folder.
 *
 *   GET  /data/...                 serve data/logbook.json and data/assets/* (dev only; the build copies them)
 *   GET  /__logbook/ping           tells the app that file saving is available
 *   PUT  /__logbook/save           body = workspace JSON  -> data/logbook.json
 *   PUT  /__logbook/save-sealed    body = encrypted line  -> data/logbook.json.enc
 *   PUT  /__logbook/asset/<name>   body = file bytes      -> data/assets/<name>
 *
 * This only exists while `npm run dev` is running, so the deployed site stays a static site.
 *
 * When data/lock.json exists the log book is encrypted in the repo (src/data/sealed.ts): the
 * browser encrypts before saving, and this server refuses to read or write plain files. With
 * LOGBOOK_PASSWORD in .env.local it also checks that each write really uses the team password.
 *
 * The build publishes a locked data/ folder as it is (encrypted). An unlocked one is published
 * plain, or encrypted on the fly when `password` is set.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { createLock, decryptBytes, encryptBytes, ENC_SUFFIX, LOCK_FILE } from './src/lib/lock.ts';
import { looksSealed, openWorkspaceText, SEALED_WORKSPACE_FILE, sealWorkspaceText, WORKSPACE_FILE } from './src/data/sealed.ts';
import { dataKey, isLocked } from './scripts/dataLock.ts';

interface Options {
  dataDir?: string;
  /** Copy data/ into the build so the deployed site shows the committed log book. */
  publishData?: boolean;
  /** Admin password for the published site. Without it, data/ is published as plain files. */
  password?: string;
}

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,150}$/;
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
      const assetsDir = path.join(dataDir, 'assets');

      // The team key from .env.local, re-read if lock.json changes (password changed). null = can't check.
      let cached: { lock: string; key: Promise<CryptoKey | null> } | null = null;
      const verifyKey = () => {
        const lock = fs.readFileSync(path.join(dataDir, LOCK_FILE), 'utf8');
        if (cached?.lock !== lock) {
          cached = {
            lock,
            key: dataKey(dataDir).catch((e: Error) => {
              server.config.logger.warn(`[logbook] ${e.message} Saves are not checked against the team password.`);
              return null;
            }),
          };
        }
        return cached.key;
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

        if (req.method === 'PUT' && pathname === '/__logbook/save') {
          if (isLocked(dataDir)) return send(res, 403, { error: 'The log book is encrypted. Sign in again.' });
          readBody(req)
            .then((body) => {
              JSON.parse(body.toString('utf8')); // refuse anything that is not valid JSON
              fs.mkdirSync(dataDir, { recursive: true });
              writeAtomic(path.join(dataDir, 'logbook.json'), body);
              send(res, 200, { ok: true, savedAt: new Date().toISOString() });
            })
            .catch((err: Error) => send(res, 400, { error: err.message }));
          return;
        }

        if (req.method === 'PUT' && pathname === '/__logbook/save-sealed') {
          if (!isLocked(dataDir)) return send(res, 400, { error: 'The log book is not encrypted' });
          readBody(req)
            .then(async (body) => {
              const text = body.toString('utf8');
              if (!looksSealed(text)) throw new Error('Not an encrypted log book');
              const key = await verifyKey();
              if (key && !(await openWorkspaceText(key, text).then(() => true, () => false))) {
                return send(res, 403, { error: 'Wrong password' });
              }
              writeAtomic(path.join(dataDir, SEALED_WORKSPACE_FILE), body);
              send(res, 200, { ok: true, savedAt: new Date().toISOString() });
            })
            .catch((err: Error) => send(res, 400, { error: err.message }));
          return;
        }

        if (req.method === 'PUT' && pathname.startsWith('/__logbook/asset/')) {
          const name = pathname.slice('/__logbook/asset/'.length);
          if (!SAFE_NAME.test(name)) return send(res, 400, { error: 'Bad file name' });
          const locked = isLocked(dataDir);
          if (locked && !name.endsWith(ENC_SUFFIX)) return send(res, 403, { error: 'The log book is encrypted. Sign in again.' });
          readBody(req)
            .then(async (body) => {
              const key = locked ? await verifyKey() : null;
              if (key && !(await decryptBytes(key, new Uint8Array(body)).then(() => true, () => false))) {
                return send(res, 403, { error: 'Wrong password' });
              }
              fs.mkdirSync(assetsDir, { recursive: true });
              writeAtomic(path.join(assetsDir, name), body);
              send(res, 200, { ok: true });
            })
            .catch((err: Error) => send(res, 400, { error: err.message }));
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
        // Already encrypted in the repo: publish lock.json and the .enc files, nothing else.
        fs.cpSync(src, dest, {
          recursive: true,
          filter: (from) =>
            fs.statSync(from).isDirectory() || path.basename(from) === LOCK_FILE || (options.publishData !== false && from.endsWith(ENC_SUFFIX)),
        });
        return;
      }
      if (!options.password) {
        if (options.publishData !== false && fs.existsSync(src)) fs.cpSync(src, dest, { recursive: true });
        return;
      }
      const { info, key } = await createLock(options.password);
      fs.mkdirSync(dest, { recursive: true });
      fs.writeFileSync(path.join(dest, LOCK_FILE), JSON.stringify(info));
      if (options.publishData === false || !fs.existsSync(src)) return;
      for (const rel of fs.readdirSync(src, { recursive: true, encoding: 'utf8' })) {
        const file = path.join(src, rel);
        if (path.basename(rel).startsWith('.') || rel.endsWith('.tmp') || !fs.statSync(file).isFile()) continue;
        const out = path.join(dest, rel + ENC_SUFFIX);
        fs.mkdirSync(path.dirname(out), { recursive: true });
        const bytes = new Uint8Array(fs.readFileSync(file));
        fs.writeFileSync(out, rel === WORKSPACE_FILE ? await sealWorkspaceText(key, new TextDecoder().decode(bytes)) : await encryptBytes(key, bytes));
      }
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

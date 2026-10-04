/**
 * The log book store: the in-memory copy the UI reads, and the code that saves it.
 *
 * Every change is applied in memory straight away, then (after a short pause) saved to
 *   1. IndexedDB in this browser, and
 *   2. data/logbook.json + data/assets/ when a writable file target is available.
 * Before writing, the file on disk is read and merged in, so a `git pull` made while the
 * app was open is never overwritten.
 *
 * To move to a shared backend later (Supabase, Firebase…), replace this module's saving and
 * loading with calls to that backend and keep the same public methods.
 */
import type { AttachmentRef, CollectionName, Project, RecordOf, Workspace } from '../types.ts';
import type { LockInfo, LockProof } from '../lib/lock.ts';
import { newId, nowStamp } from '../lib/id.ts';
import { applyChanges, type Changes } from './changes.ts';
import type { LocalDb } from './localDb.ts';
import { mergeWorkspaces, parseLogbookText, sameWorkspace } from './merge.ts';
import { COLLECTIONS, emptyWorkspace, restrictWorkspace, serializeWorkspace, sortWorkspace } from './workspace.ts';
import {
  detectDevServer,
  folderPermission,
  folderTarget,
  isFolderAccessSupported,
  pickDataFolder,
  staticTarget,
  type FileTarget,
  type TargetKind,
} from './fileTargets.ts';

export interface SaveStatus {
  ready: boolean;
  target: TargetKind | 'none';
  targetLabel: string;
  saving: boolean;
  pending: boolean;
  lastLocalSave: number | null;
  lastFileSave: number | null;
  error: string | null;
  folderSupported: boolean;
  /** A folder was connected before but the browser needs a click to allow writing again. */
  folderNeedsPermission: boolean;
}

export interface StoreOptions {
  db: LocalDb;
  /** Writable target (dev server or folder). Defaults to auto-detection. */
  detectTarget?: () => Promise<FileTarget | null>;
  /** Read-only snapshot shipped with the site. Defaults to fetching data/logbook.json. */
  snapshot?: FileTarget | null;
  debounceMs?: number;
  channelName?: string | null;
  /** The projects this session may see (locked log book), or null for all. */
  scope?: () => ReadonlySet<string> | null;
}

const FOLDER_KEY = 'folderHandle';

export class LogbookStore {
  private ws: Workspace = emptyWorkspace();
  private status: SaveStatus = {
    ready: false,
    target: 'none',
    targetLabel: 'this browser',
    saving: false,
    pending: false,
    lastLocalSave: null,
    lastFileSave: null,
    error: null,
    folderSupported: isFolderAccessSupported(),
    folderNeedsPermission: false,
  };
  private listeners = new Set<() => void>();
  private target: FileTarget | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private dirty = false;
  private lastPull = 0;
  private channel: BroadcastChannel | null = null;
  private starting: Promise<void> | null = null;
  private readonly opts: StoreOptions;

  constructor(opts: StoreOptions) {
    this.opts = opts;
  }

  // ---- reading -------------------------------------------------------------

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getState = (): Workspace => this.ws;
  getStatus = (): SaveStatus => this.status;

  /** Drop projects this session has no key for (data from another sign-in, a backup, another tab). */
  private visible(ws: Workspace): Workspace {
    const scope = this.opts.scope?.();
    return scope ? restrictWorkspace(ws, scope) : ws;
  }

  /** Projects in `ws` that this session cannot save (no password for them here). */
  outOfScope(ws: Workspace): Project[] {
    const scope = this.opts.scope?.();
    return scope ? ws.projects.filter((p) => !scope.has(p.id)) : [];
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  private setStatus(patch: Partial<SaveStatus>) {
    this.status = { ...this.status, ...patch };
    this.emit();
  }

  // ---- start-up ------------------------------------------------------------

  /** Load the log book and start saving. Safe to call again: later calls wait for the first. */
  init(): Promise<void> {
    return (this.starting ??= this.start());
  }

  private async start(): Promise<void> {
    const { db } = this.opts;
    let ws = this.visible((await db.loadWorkspace()) ?? emptyWorkspace());

    this.target = await (this.opts.detectTarget ?? (() => this.detectTarget()))();
    const sources = [this.target];
    const snapshot = this.opts.snapshot === undefined ? staticTarget() : this.opts.snapshot;
    if (snapshot && this.target?.kind !== 'dev-server') sources.push(snapshot);

    let error: string | null = null;
    for (const src of sources) {
      if (!src) continue;
      const text = await src.readWorkspace().catch(() => null);
      if (!text) continue;
      try {
        ws = mergeWorkspaces(ws, parseLogbookText(text));
      } catch (e) {
        error = `Could not read ${src.label}: ${(e as Error).message}`;
      }
    }

    this.ws = ws;
    this.setStatus({
      ready: true,
      error,
      target: this.target?.kind ?? 'none',
      targetLabel: this.target?.label ?? 'this browser',
    });
    this.listenForOtherTabs();
    this.schedule(0);
  }

  private async detectTarget(): Promise<FileTarget | null> {
    const dev = await detectDevServer();
    if (dev) return dev;
    const handle = await this.opts.db.getKv<FileSystemDirectoryHandle>(FOLDER_KEY).catch(() => undefined);
    if (!handle) return null;
    const state = await folderPermission(handle, false).catch(() => 'denied' as PermissionState);
    if (state === 'granted') return folderTarget(handle);
    this.status = { ...this.status, folderNeedsPermission: true };
    return null;
  }

  private listenForOtherTabs() {
    if (this.opts.channelName === null || typeof BroadcastChannel === 'undefined') return;
    this.channel = new BroadcastChannel(this.opts.channelName ?? 'project-logbook');
    this.channel.onmessage = async () => {
      const other = await this.opts.db.loadWorkspace();
      if (!other) return;
      const merged = mergeWorkspaces(this.ws, this.visible(other));
      if (!sameWorkspace(merged, this.ws)) {
        this.ws = merged;
        this.emit();
      }
    };
  }

  // ---- writing -------------------------------------------------------------

  /** Apply a batch of puts and deletes as one change. */
  apply(changes: Changes): void {
    this.ws = applyChanges(this.ws, changes, nowStamp());
    this.emit();
    this.schedule();
  }

  put<C extends CollectionName>(collection: C, record: RecordOf<C>): void {
    this.apply({ put: { [collection]: [record] } as Changes['put'] });
  }

  remove(collection: CollectionName, id: string): void {
    this.apply({ del: [{ collection, id }] });
  }

  /** Bring in another copy of the log book (e.g. a teammate's backup) without losing anything. */
  mergeIn(other: Workspace): void {
    this.ws = mergeWorkspaces(this.ws, this.visible(other));
    this.emit();
    this.schedule();
  }

  /**
   * Make the log book look exactly like a backup. Restored records get a fresh timestamp and
   * everything else is marked deleted, so the restore also wins when merged with teammates' copies.
   */
  restore(backup: Workspace): void {
    backup = this.visible(backup);
    const now = nowStamp();
    const keep = new Set<string>();
    const restored = sortWorkspace({ ...backup });
    for (const c of COLLECTIONS) {
      (restored[c] as { id: string; updatedAt: string }[]) = backup[c].map((r) => {
        keep.add(r.id);
        return { ...r, updatedAt: now };
      });
    }
    const dropped = COLLECTIONS.flatMap((c) =>
      this.ws[c]
        .filter((r) => !keep.has(r.id))
        .map((r) => ({ id: r.id, collection: c, deletedAt: now, projectId: 'projectId' in r ? r.projectId : r.id })),
    );
    restored.tombstones = [...backup.tombstones.filter((t) => !keep.has(t.id)), ...dropped];
    this.ws = sortWorkspace(restored);
    this.emit();
    this.schedule(0);
  }

  exportJson(projectFilter?: (ws: Workspace) => Workspace): string {
    return serializeWorkspace(projectFilter ? projectFilter(this.ws) : this.ws);
  }

  private schedule(delay = this.opts.debounceMs ?? 400) {
    this.dirty = true;
    if (!this.status.pending) this.setStatus({ pending: true });
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, delay);
  }

  /** Save now. Resolves when everything queued so far is on disk. */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    while (this.running) await this.running;
    if (!this.dirty) return;
    this.running = this.save().finally(() => {
      this.running = null;
    });
    await this.running;
    if (this.dirty && !this.timer) this.schedule();
  }

  private async save(): Promise<void> {
    this.dirty = false;
    this.setStatus({ saving: true });
    const snapshot = this.ws;
    const target = this.target;
    try {
      let merged = snapshot;
      let onDisk: string | null = null;
      if (target?.writable) {
        onDisk = await target.readWorkspace();
        if (onDisk) {
          try {
            merged = mergeWorkspaces(merged, parseLogbookText(onDisk));
          } catch (e) {
            throw new Error(`${target.label} is not valid JSON, so it was not overwritten (${(e as Error).message}). Fix it or restore a backup.`);
          }
        }
      }
      merged = this.visible(await this.opts.db.mergeAndSave(merged));
      const patch: Partial<SaveStatus> = { lastLocalSave: Date.now(), error: null };

      if (target?.writable) {
        const text = serializeWorkspace(merged);
        if (text !== onDisk) await target.writeWorkspace(text);
        await this.writeAssets(target, merged);
        patch.lastFileSave = Date.now();
      }

      // Keep anything edited while we were saving.
      this.ws = this.ws === snapshot ? merged : mergeWorkspaces(this.ws, merged);
      this.channel?.postMessage('saved');
      this.setStatus({ ...patch, saving: false, pending: this.dirty });
    } catch (e) {
      this.setStatus({ saving: false, pending: true, error: (e as Error).message });
      // Try again shortly; edits stay safe in memory (and in IndexedDB if that part worked).
      this.dirty = true;
      if (!this.timer) {
        this.timer = setTimeout(() => {
          this.timer = null;
          void this.flush();
        }, 5000);
      }
    }
  }

  private writtenKey(target: FileTarget) {
    return `assetsWritten:${target.kind}:${target.label}`;
  }

  private async writeAssets(target: FileTarget, ws: Workspace) {
    const { db } = this.opts;
    const key = this.writtenKey(target);
    const written = new Set((await db.getKv<string[]>(key)) ?? []);
    let changed = false;
    for (const entry of ws.entries) {
      for (const a of entry.attachments) {
        if (written.has(a.id)) continue;
        const blob = await db.getBlob(a.id);
        if (!blob) continue; // a teammate's file we never downloaded: it is already in their commit
        await target.writeAsset(a.file, blob, entry.projectId);
        written.add(a.id);
        changed = true;
      }
    }
    if (changed) await db.setKv(key, [...written]);
  }

  /** Re-read data/logbook.json (e.g. after a git pull) and merge it in. */
  async pull(force = false): Promise<void> {
    if (!this.status.ready || !this.target) return;
    if (!force && Date.now() - this.lastPull < 2000) return;
    this.lastPull = Date.now();
    const text = await this.target.readWorkspace().catch(() => null);
    if (!text) return;
    try {
      const merged = mergeWorkspaces(this.ws, parseLogbookText(text));
      if (!sameWorkspace(merged, this.ws)) {
        this.ws = merged;
        this.emit();
        this.schedule();
      }
    } catch (e) {
      this.setStatus({ error: `Could not read ${this.target.label}: ${(e as Error).message}` });
    }
  }

  // ---- attachments ---------------------------------------------------------

  async addAttachment(blob: Blob, name: string): Promise<AttachmentRef> {
    const id = newId();
    const ext = extensionFor(blob.type, name);
    await this.opts.db.putBlob(id, blob);
    return { id, name, mime: blob.type || 'application/octet-stream', size: blob.size, file: `assets/${id}.${ext}` };
  }

  async getAttachment(ref: AttachmentRef): Promise<Blob | null> {
    const { db } = this.opts;
    const local = await db.getBlob(ref.id);
    if (local) return local;
    const snapshot = this.opts.snapshot === undefined ? staticTarget() : this.opts.snapshot;
    const projectId = this.ws.entries.find((e) => e.attachments.some((a) => a.id === ref.id))?.projectId ?? '';
    for (const src of [this.target, snapshot]) {
      if (!src) continue;
      const blob = await src.readAsset(ref.file, projectId).catch(() => null);
      if (!blob) continue;
      await db.putBlob(ref.id, blob);
      if (this.target?.writable) {
        // It came from disk, so there's no need to write it back.
        const key = this.writtenKey(this.target);
        const written = new Set((await db.getKv<string[]>(key)) ?? []);
        written.add(ref.id);
        await db.setKv(key, [...written]);
      }
      return blob;
    }
    return null;
  }

  // ---- locked log book -----------------------------------------------------

  /** True when changes reach data/ (dev server or connected folder), not just this browser. */
  get canWriteFiles(): boolean {
    return !!this.target?.writable;
  }

  /** Change data/lock.json (add a project, rename one). Needs a writable target. */
  async updateLock(change: (info: LockInfo) => LockInfo | Promise<LockInfo>, proof?: LockProof): Promise<void> {
    const target = this.target;
    if (!target?.writable) throw new Error('Run `npm run dev` or connect the data folder first, so the new password can be saved.');
    // Read it fresh: a git pull may have added another project's password since sign-in.
    const info = await target.readLock();
    if (!info) throw new Error('data/lock.json is missing or out of date. Run `npm run lock` in the repo.');
    const next = await change(info);
    if (JSON.stringify(next) !== JSON.stringify(info)) await target.writeLock(next, proof);
  }

  /** Save what is pending, then remove the log book from this browser (used when logging out). */
  async clearLocalCopy(): Promise<void> {
    await this.flush().catch(() => undefined);
    await this.opts.db.clearWorkspace();
  }

  // ---- folder connection (deployed site in Chrome/Edge) --------------------

  async connectFolder(): Promise<void> {
    const dir = await pickDataFolder();
    await this.opts.db.setKv(FOLDER_KEY, dir);
    this.useTarget(folderTarget(dir));
  }

  async reconnectFolder(): Promise<void> {
    const dir = await this.opts.db.getKv<FileSystemDirectoryHandle>(FOLDER_KEY);
    if (!dir) return this.connectFolder();
    if ((await folderPermission(dir, true)) !== 'granted') throw new Error('Permission to write to the folder was not given.');
    this.useTarget(folderTarget(dir));
  }

  async disconnectFolder(): Promise<void> {
    await this.opts.db.deleteKv(FOLDER_KEY);
    if (this.target?.kind === 'folder') this.target = null;
    this.setStatus({ target: 'none', targetLabel: 'this browser', folderNeedsPermission: false, lastFileSave: null });
  }

  private useTarget(target: FileTarget) {
    this.target = target;
    this.setStatus({ target: target.kind, targetLabel: target.label, folderNeedsPermission: false, error: null });
    void this.pull(true).then(() => this.schedule(0));
  }

  get hasPendingWork(): boolean {
    return this.dirty || !!this.running;
  }
}

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/csv': 'csv',
};

export function extensionFor(mime: string, name: string): string {
  const fromName = /\.([A-Za-z0-9]{1,8})$/.exec(name)?.[1]?.toLowerCase();
  return EXT_BY_MIME[mime] ?? fromName ?? 'bin';
}

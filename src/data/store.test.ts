import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { FileTarget } from './fileTargets.ts';
import { newEntry, newMember, newProject } from './factories.ts';
import { openLocalDb } from './localDb.ts';
import { LogbookStore } from './store.ts';
import { parseWorkspace, serializeWorkspace } from './workspace.ts';
import { applyChanges } from './changes.ts';
import { emptyWorkspace } from './workspace.ts';

/** An in-memory stand-in for data/logbook.json + data/assets/. */
function memoryTarget(initial: string | null = null) {
  const files = new Map<string, Blob>();
  const target: FileTarget & { text: string | null; writes: number } = {
    kind: 'dev-server',
    label: 'data/logbook.json',
    writable: true,
    text: initial,
    writes: 0,
    async readWorkspace() {
      return target.text;
    },
    async writeWorkspace(text) {
      target.text = text;
      target.writes++;
    },
    async readAsset(file) {
      return files.get(file) ?? null;
    },
    async writeAsset(file, blob) {
      files.set(file, blob);
    },
    async readLock() {
      return null;
    },
    async writeLock() {},
  };
  return { target, files };
}

let dbCount = 0;
function makeStore(target: FileTarget | null) {
  return new LogbookStore({
    db: openLocalDb(`test-${++dbCount}`),
    detectTarget: async () => target,
    snapshot: null,
    debounceMs: 5,
    channelName: null,
  });
}

function seed() {
  const project = newProject({ name: 'P' });
  const member = newMember(project.id, { name: 'Ana' });
  return { project, member };
}

describe('LogbookStore', () => {
  it('writes every change to logbook.json', async () => {
    const { target } = memoryTarget();
    const store = makeStore(target);
    await store.init();
    const { project, member } = seed();
    store.apply({ put: { projects: [project], members: [member] } });
    store.put('entries', newEntry(project.id, { authorId: member.id, did: 'Set up broker', hours: 2 }));
    await store.flush();

    const onDisk = parseWorkspace(target.text!);
    expect(onDisk.entries).toHaveLength(1);
    expect(onDisk.entries[0].did).toBe('Set up broker');
    expect(store.getStatus().lastFileSave).not.toBeNull();
  });

  it('loads what is on disk and keeps it after a restart (IndexedDB)', async () => {
    const { project, member } = seed();
    const fileWs = applyChanges(emptyWorkspace(), { put: { projects: [project], members: [member] } }, '2026-10-01T00:00:00.000Z');
    const { target } = memoryTarget(serializeWorkspace(fileWs));
    const db = openLocalDb(`test-restart-${++dbCount}`);
    const first = new LogbookStore({ db, detectTarget: async () => target, snapshot: null, debounceMs: 5, channelName: null });
    await first.init();
    expect(first.getState().members[0].name).toBe('Ana');
    first.put('entries', newEntry(project.id, { authorId: member.id, did: 'offline work' }));
    await first.flush();

    // Restart without the file: data comes back from IndexedDB.
    const second = new LogbookStore({ db, detectTarget: async () => null, snapshot: null, debounceMs: 5, channelName: null });
    await second.init();
    expect(second.getState().entries.map((e) => e.did)).toEqual(['offline work']);
  });

  it('never overwrites entries that arrived in the file (e.g. git pull) while the app was open', async () => {
    const { target } = memoryTarget();
    const store = makeStore(target);
    await store.init();
    const { project, member } = seed();
    store.apply({ put: { projects: [project], members: [member] } });
    await store.flush();

    // A teammate's entry lands in the file behind the app's back.
    const teammate = applyChanges(parseWorkspace(target.text!), { put: { entries: [newEntry(project.id, { authorId: member.id, did: 'teammate' })] } }, new Date().toISOString());
    target.text = serializeWorkspace(teammate);

    store.put('entries', newEntry(project.id, { authorId: member.id, did: 'mine' }));
    await store.flush();

    const dids = parseWorkspace(target.text!).entries.map((e) => e.did).sort();
    expect(dids).toEqual(['mine', 'teammate']);
    expect(store.getState().entries).toHaveLength(2);
  });

  it('deletes records and remembers the deletion', async () => {
    const { target } = memoryTarget();
    const store = makeStore(target);
    await store.init();
    const { project, member } = seed();
    const entry = newEntry(project.id, { authorId: member.id });
    store.apply({ put: { projects: [project], members: [member], entries: [entry] } });
    await store.flush();
    store.remove('entries', entry.id);
    await store.flush();
    const onDisk = parseWorkspace(target.text!);
    expect(onDisk.entries).toHaveLength(0);
    expect(onDisk.tombstones.map((t) => t.id)).toContain(entry.id);
  });

  it('restores a backup exactly, even against newer local data', async () => {
    const { target } = memoryTarget();
    const store = makeStore(target);
    await store.init();
    const { project, member } = seed();
    store.apply({ put: { projects: [project], members: [member] } });
    await store.flush();
    const backup = parseWorkspace(store.exportJson());

    store.put('entries', newEntry(project.id, { authorId: member.id, did: 'added after backup' }));
    await store.flush();
    expect(store.getState().entries).toHaveLength(1);

    store.restore(backup);
    await store.flush();
    expect(store.getState().entries).toHaveLength(0);
    expect(parseWorkspace(target.text!).entries).toHaveLength(0);
    expect(store.getState().members[0].name).toBe('Ana');
  });

  it('stores attachments and writes them to data/assets/', async () => {
    const { target, files } = memoryTarget();
    const store = makeStore(target);
    await store.init();
    const { project, member } = seed();
    const ref = await store.addAttachment(new Blob(['png-bytes'], { type: 'image/png' }), 'screenshot.png');
    expect(ref.file).toMatch(/^assets\/.+\.png$/);
    store.apply({ put: { projects: [project], members: [member], entries: [newEntry(project.id, { authorId: member.id, attachments: [ref] })] } });
    await store.flush();
    expect(files.has(ref.file)).toBe(true);
    expect(await (await store.getAttachment(ref))!.text()).toBe('png-bytes');
  });

  it('works with no file at all (browser-only mode)', async () => {
    const store = makeStore(null);
    await store.init();
    const { project } = seed();
    store.put('projects', project);
    await store.flush();
    expect(store.getStatus().target).toBe('none');
    expect(store.getStatus().lastLocalSave).not.toBeNull();
    expect(store.getStatus().lastFileSave).toBeNull();
  });

  it('refuses to overwrite a corrupted logbook.json', async () => {
    const { target } = memoryTarget('{ this is not json');
    const store = makeStore(target);
    await store.init();
    const { project } = seed();
    store.put('projects', project);
    await store.flush();
    expect(target.text).toBe('{ this is not json');
    expect(store.getStatus().error).toMatch(/not valid JSON/);
  });

  it('keeps out projects this session has no password for', async () => {
    const mine = newProject({ name: 'Mine' });
    const other = newProject({ name: 'Other' });
    const db = openLocalDb(`test-${++dbCount}`);
    // A copy left in the browser by an earlier sign-in to the other project.
    await db.replace(applyChanges(emptyWorkspace(), { put: { projects: [other] } }, '2026-10-01T00:00:00.000Z'));
    const store = new LogbookStore({ db, detectTarget: async () => null, snapshot: null, debounceMs: 5, channelName: null, scope: () => new Set([mine.id]) });
    await store.init();
    expect(store.getState().projects).toEqual([]);

    const backup = applyChanges(emptyWorkspace(), { put: { projects: [mine, other], entries: [newEntry(other.id, { did: 'secret' })] } }, '2026-10-01T00:00:00.000Z');
    expect(store.outOfScope(backup).map((p) => p.name)).toEqual(['Other']);
    store.mergeIn(backup);
    expect(store.getState().projects.map((p) => p.name)).toEqual(['Mine']);
    expect(store.getState().entries).toEqual([]);
  });
});

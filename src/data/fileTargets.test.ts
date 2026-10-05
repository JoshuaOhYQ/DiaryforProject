import { describe, expect, it } from 'vitest';
import { newDataKey, type ProjectKeys } from '../lib/lock.ts';
import { applyChanges } from './changes.ts';
import { codec, type RawFiles } from './fileTargets.ts';
import { newEntry, newProject } from './factories.ts';
import { openWorkspaceText, projectAssetPath, projectWorkspacePath } from './sealed.ts';
import { emptyWorkspace, parseWorkspace, serializeWorkspace } from './workspace.ts';

/** data/ as an in-memory map of path -> contents. */
function memoryFiles() {
  const files = new Map<string, string | Blob>();
  const writes: string[] = [];
  const raw: RawFiles = {
    async readText(file) {
      const v = files.get(file);
      return v === undefined ? null : typeof v === 'string' ? v : v.text();
    },
    async readBlob(file) {
      const v = files.get(file);
      return v === undefined ? null : new Blob([v]);
    },
    async writeText(file, text) {
      files.set(file, text);
      writes.push(file);
    },
    async writeBlob(file, blob) {
      files.set(file, blob);
      writes.push(file);
    },
    async removeDir(dir) {
      for (const file of [...files.keys()]) if (file.startsWith(`${dir}/`)) files.delete(file);
    },
  };
  return { files, writes, raw };
}

async function twoProjects() {
  const a = newProject({ name: 'Alpha' });
  const b = newProject({ name: 'Bravo' });
  const ws = applyChanges(emptyWorkspace(), { put: { projects: [a, b], entries: [newEntry(a.id, { did: 'alpha work' }), newEntry(b.id, { did: 'bravo work' })] } }, '2026-10-01T00:00:00.000Z');
  const keys: ProjectKeys = new Map([
    [a.id, await newDataKey()],
    [b.id, await newDataKey()],
  ]);
  return { a, b, ws, keys };
}

describe('locked file target', () => {
  it('writes each project to its own file, encrypted with its own key', async () => {
    const { a, b, ws, keys } = await twoProjects();
    const { files, raw } = memoryFiles();
    await codec(raw, () => keys).writeWorkspace(serializeWorkspace(ws));

    const alpha = parseWorkspace(await openWorkspaceText(keys.get(a.id)!, files.get(projectWorkspacePath(a.id)) as string));
    expect(alpha.projects.map((p) => p.name)).toEqual(['Alpha']);
    expect(alpha.entries.map((e) => e.did)).toEqual(['alpha work']);
    await expect(openWorkspaceText(keys.get(a.id)!, files.get(projectWorkspacePath(b.id)) as string)).rejects.toThrow();
    expect([...files.keys()].sort()).toEqual([projectWorkspacePath(a.id), projectWorkspacePath(b.id)].sort());
  });

  it("reads and writes only the projects it has keys for", async () => {
    const { a, b, ws, keys } = await twoProjects();
    const { files, writes, raw } = memoryFiles();
    await codec(raw, () => keys).writeWorkspace(serializeWorkspace(ws));
    const bravoFile = files.get(projectWorkspacePath(b.id));

    const onlyA = codec(raw, () => new Map([[a.id, keys.get(a.id)!]]));
    const seen = parseWorkspace((await onlyA.readWorkspace())!);
    expect(seen.projects.map((p) => p.name)).toEqual(['Alpha']);
    expect(seen.entries.map((e) => e.did)).toEqual(['alpha work']);

    writes.length = 0;
    const edited = applyChanges(ws, { put: { projects: [{ ...a, name: 'Alpha 2' }, { ...b, name: 'Hijacked' }] } }, '2026-10-02T00:00:00.000Z');
    await onlyA.writeWorkspace(serializeWorkspace(edited));
    expect(writes).toEqual([projectWorkspacePath(a.id)]);
    expect(files.get(projectWorkspacePath(b.id))).toBe(bravoFile);
  });

  it('leaves unchanged projects and existing attachments alone', async () => {
    const { a, ws, keys } = await twoProjects();
    const { writes, raw } = memoryFiles();
    const target = codec(raw, () => keys);
    await target.writeWorkspace(serializeWorkspace(ws));
    writes.length = 0;
    await target.writeWorkspace(serializeWorkspace(ws));
    expect(writes).toEqual([]);

    await target.writeAsset('assets/x.png', new Blob(['png-bytes'], { type: 'image/png' }), a.id);
    await target.writeAsset('assets/x.png', new Blob(['png-bytes'], { type: 'image/png' }), a.id);
    expect(writes).toEqual([projectAssetPath(a.id, 'assets/x.png')]);
    const back = await target.readAsset('assets/x.png', a.id);
    expect(await back!.text()).toBe('png-bytes');
    expect(back!.type).toBe('image/png');
    expect(await target.readAsset('assets/x.png', 'someone-else')).toBeNull();
  });

  it('records which project a deletion belongs to', async () => {
    const { a, b, ws, keys } = await twoProjects();
    const entryA = ws.entries.find((e) => e.projectId === a.id)!;
    const deleted = applyChanges(ws, { del: [{ collection: 'entries', id: entryA.id }] }, '2026-10-03T00:00:00.000Z');
    expect(deleted.tombstones).toEqual([{ id: entryA.id, collection: 'entries', deletedAt: '2026-10-03T00:00:00.000Z', projectId: a.id }]);

    const { files, raw } = memoryFiles();
    await codec(raw, () => keys).writeWorkspace(serializeWorkspace(deleted));
    const bravo = parseWorkspace(await openWorkspaceText(keys.get(b.id)!, files.get(projectWorkspacePath(b.id)) as string));
    expect(bravo.tombstones).toEqual([]);
  });

  it("removes a deleted project's folder and nothing else", async () => {
    const { a, b, ws, keys } = await twoProjects();
    const { files, raw } = memoryFiles();
    const target = codec(raw, () => keys);
    await target.writeWorkspace(serializeWorkspace(ws));
    await target.writeAsset('assets/x.png', new Blob(['png']), a.id);
    await target.removeProject(a.id);
    expect([...files.keys()]).toEqual([projectWorkspacePath(b.id)]);
  });
});

import { describe, expect, it } from 'vitest';
import {
  addAdminCopy,
  checkAdminKey,
  checkProjectKey,
  decryptBytes,
  encryptBytes,
  exportKey,
  importKey,
  listProjects,
  newLock,
  passwordKey,
  recoverProjectKey,
  setAdminPassword,
  setProjectName,
  setProjectPassword,
  unlockAdmin,
  unlockProject,
  unlockProjects,
} from './lock.ts';

// Each password check is deliberately slow (PBKDF2, 600 000 rounds), and some tests do several.
describe('lock', { timeout: 30_000 }, () => {
  it('opens a project with its own password only', async () => {
    let lock = newLock();
    ({ info: lock } = await setProjectPassword(lock, 'a', 'alpha password'));
    const b = await setProjectPassword(lock, 'b', 'bravo password');
    lock = b.info;
    const sealed = await encryptBytes(b.key, new TextEncoder().encode('{"projects":[]}'));

    expect((await unlockProjects(lock, 'wrong')).size).toBe(0);
    expect([...(await unlockProjects(lock, 'alpha password')).keys()]).toEqual(['a']);
    const opened = await unlockProjects(lock, 'bravo password');
    expect([...opened.keys()]).toEqual(['b']);
    expect(new TextDecoder().decode(await decryptBytes(opened.get('b')!, sealed))).toBe('{"projects":[]}');
    await expect(decryptBytes((await unlockProjects(lock, 'alpha password')).get('a')!, sealed)).rejects.toThrow();
  });

  it('survives exporting the key for the session, until the password changes', async () => {
    const first = await setProjectPassword(newLock(), 'a', 'pw');
    const restored = await importKey(await exportKey(first.key));
    expect(await checkProjectKey(first.info, 'a', restored)).toBe(true);
    expect(await checkProjectKey(first.info, 'b', restored)).toBe(false); // bound to its project

    const changed = await setProjectPassword(first.info, 'a', 'new pw');
    expect(await checkProjectKey(changed.info, 'a', restored)).toBe(false);
    expect((await unlockProjects(changed.info, 'pw')).size).toBe(0);
    expect((await unlockProjects(changed.info, 'new pw')).has('a')).toBe(true);
  });

  it('opens only the chosen project, and lists projects by their public name', async () => {
    let lock = newLock();
    ({ info: lock } = await setProjectPassword(lock, 'a', 'shared pw', { name: 'Zebra' }));
    ({ info: lock } = await setProjectPassword(lock, 'b', 'shared pw', { name: 'Apple' }));
    expect(await unlockProject(lock, 'a', 'wrong')).toBeNull();
    expect(await checkProjectKey(lock, 'a', (await unlockProject(lock, 'a', 'shared pw'))!)).toBe(true);
    expect(listProjects(lock)).toEqual([
      { id: 'b', name: 'Apple' },
      { id: 'a', name: 'Zebra' },
    ]);

    // A new password keeps the name; renaming keeps the keys.
    ({ info: lock } = await setProjectPassword(lock, 'a', 'new pw'));
    expect(lock.projects.a.name).toBe('Zebra');
    const renamed = setProjectName(lock, 'a', 'Yak');
    expect(renamed.projects.a).toEqual({ ...lock.projects.a, name: 'Yak' });
  });

  it('checks the admin password, which opens no project', async () => {
    let lock = newLock();
    expect(await unlockAdmin(lock, 'anything')).toBeNull(); // none set yet
    ({ info: lock } = await setProjectPassword(lock, 'a', 'project pw'));
    lock = await setAdminPassword(lock, 'admin pw');
    expect(await unlockAdmin(lock, 'project pw')).toBeNull();
    const admin = await unlockAdmin(lock, 'admin pw');
    expect(admin).not.toBeNull();
    expect(await checkAdminKey(lock, await importKey(await exportKey(admin!)))).toBe(true);
    expect((await unlockProjects(lock, 'admin pw')).size).toBe(0);
  });

  it('lets the admin reset a forgotten project password, keeping the data key', async () => {
    let lock = await setAdminPassword(newLock(), 'admin pw');
    const adminKey = (await unlockAdmin(lock, 'admin pw'))!;
    const created = await setProjectPassword(lock, 'a', 'forgotten pw', { name: 'Alpha', adminKey });
    lock = created.info;
    const remembered = await importKey(await exportKey(created.key));

    const dataKey = (await recoverProjectKey(lock, 'a', adminKey))!;
    expect(await exportKey(dataKey)).toBe(await exportKey(created.key));
    const reset = (await setProjectPassword(lock, 'a', 'new pw', { dataKey })).info;
    expect(await unlockProject(reset, 'a', 'forgotten pw')).toBeNull();
    expect(await unlockProject(reset, 'a', 'new pw')).not.toBeNull();
    expect(reset.projects.a.check).toBe(lock.projects.a.check); // nothing to re-encrypt, sign-ins kept
    expect(reset.projects.a.admin).toBe(lock.projects.a.admin);
    expect(await checkProjectKey(reset, 'a', remembered)).toBe(true);
    expect(await recoverProjectKey(reset, 'a', await passwordKey(reset, 'new pw'))).toBeNull();
  });

  it('moves the admin copies to a new admin password, and adds them to older projects', async () => {
    let lock = newLock();
    const older = await setProjectPassword(lock, 'old', 'old pw'); // made before admin copies existed
    lock = await setAdminPassword(older.info, 'admin 1');
    const admin1 = (await unlockAdmin(lock, 'admin 1'))!;
    expect(await recoverProjectKey(lock, 'old', admin1)).toBeNull();
    lock = await addAdminCopy(lock, 'old', older.key, admin1);
    expect(await recoverProjectKey(lock, 'old', admin1)).not.toBeNull();

    const changed = await setAdminPassword(lock, 'admin 2', admin1);
    expect(await unlockAdmin(changed, 'admin 1')).toBeNull();
    expect(await recoverProjectKey(changed, 'old', (await unlockAdmin(changed, 'admin 2'))!)).not.toBeNull();
    // Without the current admin key the copies are dropped rather than left unusable.
    expect((await setAdminPassword(lock, 'admin 3')).projects.old.admin).toBeUndefined();
  });
});

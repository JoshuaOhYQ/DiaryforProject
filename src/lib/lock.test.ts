import { describe, expect, it } from 'vitest';
import { checkProjectKey, decryptBytes, encryptBytes, exportKey, importKey, newLock, setProjectPassword, unlockProjects } from './lock.ts';

describe('lock', () => {
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
});

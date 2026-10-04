import { describe, expect, it } from 'vitest';
import { createLock, decryptBytes, encryptBytes, exportKey, importKey, unlock, checkKey } from './lock.ts';

describe('lock', () => {
  it('opens with the right password only', async () => {
    const { info, key } = await createLock('correct horse');
    const sealed = await encryptBytes(key, new TextEncoder().encode('{"projects":[]}'));

    expect(await unlock(info, 'wrong')).toBeNull();
    const opened = await unlock(info, 'correct horse');
    expect(opened).not.toBeNull();
    expect(new TextDecoder().decode(await decryptBytes(opened!, sealed))).toBe('{"projects":[]}');
  });

  it('survives exporting the key for the session', async () => {
    const { info, key } = await createLock('pw');
    const restored = await importKey(await exportKey(key));
    expect(await checkKey(info, restored)).toBe(true);
    expect(await checkKey((await createLock('pw')).info, restored)).toBe(false); // new salt after a rebuild
  });
});

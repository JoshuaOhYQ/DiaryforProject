import { describe, expect, it } from 'vitest';
import { newDataKey } from '../lib/lock.ts';
import { looksSealed, openWorkspaceText, sealWorkspaceText } from './sealed.ts';
import { parseLogbookText } from './merge.ts';
import { newProject } from './factories.ts';
import { emptyWorkspace, serializeWorkspace } from './workspace.ts';

const workspaceWith = (name: string) => serializeWorkspace({ ...emptyWorkspace(), projects: [newProject({ name })] });

describe('sealed log book', () => {
  it('round-trips and hides the content', async () => {
    const key = await newDataKey();
    const json = workspaceWith('Secret robot');
    const sealed = await sealWorkspaceText(key, json);
    expect(looksSealed(sealed)).toBe(true);
    expect(sealed).not.toContain('Secret');
    expect(await openWorkspaceText(key, sealed)).toBe(json);
  });

  it('refuses a different key', async () => {
    const sealed = await sealWorkspaceText(await newDataKey(), workspaceWith('x'));
    await expect(openWorkspaceText(await newDataKey(), sealed)).rejects.toThrow(/password/);
  });

  it('merges both sides of a Git conflict in the encrypted file', async () => {
    const key = await newDataKey();
    const ours = await sealWorkspaceText(key, workspaceWith('Ours'));
    const theirs = await sealWorkspaceText(key, workspaceWith('Theirs'));
    const conflicted = `<<<<<<< HEAD\n${ours}=======\n${theirs}>>>>>>> origin/main\n`;
    const ws = parseLogbookText(await openWorkspaceText(key, conflicted));
    expect(ws.projects.map((p) => p.name).sort()).toEqual(['Ours', 'Theirs']);
  });
});

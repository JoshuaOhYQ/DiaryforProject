import { useState, type FormEvent } from 'react';
import { addToSession, loadLock } from '../app/auth.ts';
import { getDataKeys, store } from '../data/index.ts';
import { setPref } from '../lib/prefs.ts';
import { unlockProjects } from '../lib/lock.ts';
import { Modal } from './Modal.tsx';
import { PasswordField } from './PasswordField.tsx';

/** Add another project to this session by entering that project's password. */
export function UnlockProjectDialog({ onClose }: { onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    const lock = await loadLock();
    const keys = lock && lock !== 'outdated' ? await unlockProjects(lock, password).catch(() => null) : null;
    const open = getDataKeys();
    const fresh = keys && new Map([...keys].filter(([id]) => !open?.has(id)));
    if (!fresh?.size) {
      setBusy(false);
      setError(keys?.size ? 'That project is already open.' : 'Wrong password.');
      return;
    }
    await addToSession(fresh);
    setPref('project', [...fresh.keys()][0]);
    // Reload so the new project is read from the files like at sign-in.
    await store.flush().catch(() => undefined);
    location.reload();
  };

  return (
    <Modal
      title="Open another project"
      onClose={onClose}
      size="narrow"
      dismissOnBackdrop={false}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" type="submit" form="unlock-form" disabled={busy || !password}>
            {busy ? 'Checking…' : 'Open project'}
          </button>
        </>
      }
    >
      <form id="unlock-form" className="stack" onSubmit={submit}>
        <PasswordField
          id="unlock-password"
          label="Project password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          autoFocus
          error={error}
          hint="Each project has its own password. The projects you already have open stay open."
        />
      </form>
    </Modal>
  );
}

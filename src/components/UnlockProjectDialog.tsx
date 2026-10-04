import { useEffect, useState, type FormEvent } from 'react';
import { addToSession, loadLock } from '../app/auth.ts';
import { getDataKeys, store } from '../data/index.ts';
import { setPref } from '../lib/prefs.ts';
import { listProjects, unlockProject, type LockInfo } from '../lib/lock.ts';
import { Modal } from './Modal.tsx';
import { PasswordField } from './PasswordField.tsx';
import { ProjectSelect } from './ProjectSelect.tsx';

/** Add another project to this session: choose it and enter that project's password. */
export function UnlockProjectDialog({ onClose }: { onClose: () => void }) {
  const [lock, setLock] = useState<LockInfo | null>(null);
  const [projectId, setProjectId] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Read lock.json fresh: a git pull may have added projects since sign-in.
  useEffect(() => {
    void loadLock().then((l) => setLock(l && l !== 'outdated' ? l : null));
  }, []);
  const open = getDataKeys();
  const projects = lock ? listProjects(lock).filter((p) => !open?.has(p.id)) : [];
  const onlyChoice = projects.length === 1 ? projects[0].id : '';
  useEffect(() => {
    if (onlyChoice) setProjectId((id) => id || onlyChoice);
  }, [onlyChoice]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!lock || !projectId || !password || busy) return;
    setBusy(true);
    setError(null);
    const key = await unlockProject(lock, projectId, password).catch(() => null);
    if (!key) {
      setBusy(false);
      setError('Wrong password for this project.');
      return;
    }
    await addToSession(new Map([[projectId, key]]));
    setPref('project', projectId);
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
          <button className="btn primary" type="submit" form="unlock-form" disabled={busy || !projectId || !password}>
            {busy ? 'Checking…' : 'Open project'}
          </button>
        </>
      }
    >
      <form id="unlock-form" className="stack" onSubmit={submit}>
        {!lock ? (
          <p className="muted">Loading projects…</p>
        ) : !projects.length ? (
          <p className="muted">Every project is already open.</p>
        ) : (
          <>
            <ProjectSelect id="unlock-project" projects={projects} value={projectId} onChange={(id) => (setProjectId(id), setError(null))} />
            <PasswordField
              id="unlock-password"
              label="Password"
              value={password}
              onChange={setPassword}
              autoComplete="current-password"
              autoFocus
              error={error}
              hint="The projects you already have open stay open."
            />
          </>
        )}
      </form>
    </Modal>
  );
}

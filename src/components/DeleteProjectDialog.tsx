import { useState, type FormEvent } from 'react';
import { Trash2 } from 'lucide-react';
import type { Project } from '../types.ts';
import { isLockedSite } from '../app/auth.ts';
import { deleteProject } from '../app/projects.ts';
import { toast } from '../app/toast.tsx';
import { useWorkspace } from '../data/index.ts';
import { pluralise } from '../lib/text.ts';
import { Modal } from './Modal.tsx';
import { PasswordField } from './PasswordField.tsx';

/**
 * Confirm deleting a project. On a locked log book only an admin can, with the admin password;
 * otherwise you type the project's name.
 */
export function DeleteProjectDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const ws = useWorkspace();
  const locked = isLockedSite();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const entries = ws.entries.filter((e) => e.projectId === project.id).length;
  const tasks = ws.tasks.filter((t) => t.projectId === project.id).length;
  const ready = locked ? typed.length > 0 : typed.trim() === project.name.trim();

  const remove = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await deleteProject(ws, project.id, locked ? typed : '');
      toast(`Deleted “${project.name}”`);
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Delete “${project.name}”?`}
      onClose={onClose}
      size="narrow"
      dismissOnBackdrop={false}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn danger-solid" type="submit" form="delete-form" disabled={!ready || busy}>
            <Trash2 size={16} /> {busy ? 'Deleting…' : 'Delete project'}
          </button>
        </>
      }
    >
      <form id="delete-form" className="stack" onSubmit={remove}>
        <div className="notice danger">
          <span>
            This deletes {pluralise(entries, 'entry', 'entries')}, {pluralise(tasks, 'task', 'tasks')}, the team and the log book pages of this project.
            {locked && ' It also disappears from the sign-in page and its password stops working.'} The app can’t undo this; only an older Git commit
            still has it.
          </span>
        </div>
        {locked ? (
          <PasswordField
            id="delete-admin"
            label="Admin password"
            value={typed}
            onChange={setTyped}
            autoComplete="current-password"
            autoFocus
            error={error}
            hint="Only an admin can delete a project."
          />
        ) : (
          <div className="field">
            <label htmlFor="delete-confirm">
              Type <strong>{project.name}</strong> to confirm
            </label>
            <input id="delete-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus autoComplete="off" spellCheck={false} />
          </div>
        )}
        {error && !locked && (
          <span className="login-error" role="alert">
            {error}
          </span>
        )}
      </form>
    </Modal>
  );
}

import { useState } from 'react';
import { useSaveStatus, type ProjectData } from '../data/index.ts';
import { TEMPLATES, type ProjectTemplate } from '../templates/index.ts';
import { isLockedSite } from '../app/auth.ts';
import { createProject, templateFromProject } from '../app/projects.ts';
import { Modal } from './Modal.tsx';
import { PasswordField } from './PasswordField.tsx';

interface Props {
  current: ProjectData | null;
  onClose: () => void;
  onCreated: (projectId: string) => void;
}

const MIN_PASSWORD = 8;

export function NewProjectDialog({ current, onClose, onCreated }: Props) {
  const options: ProjectTemplate[] = current ? [templateFromProject(current), ...TEMPLATES] : TEMPLATES;
  const [choice, setChoice] = useState(options[options.length - 1].key);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const status = useSaveStatus();
  const template = options.find((t) => t.key === choice)!;
  // On a locked log book every project has its own password, which must be saved in data/lock.json.
  const locked = isLockedSite();
  const canSaveLock = status.target === 'dev-server' || status.target === 'folder';

  async function create() {
    if (busy) return;
    if (locked) {
      if (password.length < MIN_PASSWORD) return setError(`Use at least ${MIN_PASSWORD} characters.`);
      if (password !== confirm) return setError('The two passwords are different.');
    }
    setBusy(true);
    setError(null);
    try {
      const id = await createProject(template, { name: name.trim() || template.project.name || 'New project' }, locked ? password : undefined);
      onCreated(id);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title="New project"
      onClose={onClose}
      dismissOnBackdrop={!locked}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={() => void create()} disabled={busy || (locked && !canSaveLock)}>
            {busy ? 'Creating…' : 'Create project'}
          </button>
        </>
      }
    >
      <TemplatePicker options={options} value={choice} onChange={setChoice} />
      <div className="field" style={{ marginTop: '1rem' }}>
        <label htmlFor="np-name">Project name</label>
        <input id="np-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={template.project.name || 'New project'} autoFocus />
      </div>
      {locked && !canSaveLock && (
        <div className="notice warn" style={{ marginTop: '1rem' }}>
          <span>New projects need their own password, saved in data/lock.json. Run the app with `npm run dev`, or connect the data folder in Settings, then try again.</span>
        </div>
      )}
      {locked && canSaveLock && (
        <div className="stack" style={{ marginTop: '1rem' }}>
          <PasswordField
            id="np-password"
            label="Password for this project"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            hint="Only people with this password can open this project. Use a long, random one."
          />
          <PasswordField id="np-confirm" label="Type it again" value={confirm} onChange={setConfirm} autoComplete="new-password" error={error} />
        </div>
      )}
      {error && !(locked && canSaveLock) && (
        <div className="notice danger" style={{ marginTop: '1rem' }}>
          {error}
        </div>
      )}
    </Modal>
  );
}

export function TemplatePicker({ options, value, onChange }: { options: ProjectTemplate[]; value: string; onChange: (key: string) => void }) {
  return (
    <div className="template-list" role="radiogroup" aria-label="Start from">
      {options.map((t) => (
        <button key={t.key} type="button" className="template-option" role="radio" aria-checked={value === t.key} onClick={() => onChange(t.key)}>
          <strong>{t.label}</strong>
          <span className="small muted">
            {t.description ||
              `${t.members.length} members, ${t.features.length} features. Tasks and entries are not copied.`}
          </span>
        </button>
      ))}
    </div>
  );
}

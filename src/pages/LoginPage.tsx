import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowLeft, FolderOpen, LockKeyhole, NotebookPen, Plus } from 'lucide-react';
import { startSession } from '../app/auth.ts';
import { cannotSaveNewProject, createLockedProject } from '../app/projects.ts';
import { getDataKeys, setDataKeys, store, useSaveStatus } from '../data/index.ts';
import { PasswordField } from '../components/PasswordField.tsx';
import { ProjectSelect } from '../components/ProjectSelect.tsx';
import { getPref, setPref } from '../lib/prefs.ts';
import { listProjects, unlockProject, type LockInfo } from '../lib/lock.ts';
import { TEMPLATES } from '../templates/index.ts';

const MIN_PASSWORD = 8;

/**
 * Shown before anything else on a password-protected log book: choose a project and type its
 * password, or create a new project with the admin password.
 */
export function LoginPage({ lock, onUnlocked }: { lock: LockInfo; onUnlocked: () => void }) {
  const [mode, setMode] = useState<'sign-in' | 'create'>(Object.keys(lock.projects).length ? 'sign-in' : 'create');
  return (
    <div className={`login ${mode === 'create' ? 'wide' : ''}`}>
      {mode === 'sign-in' ? (
        <SignIn lock={lock} onUnlocked={onUnlocked} onCreate={() => setMode('create')} />
      ) : (
        <CreateProject lock={lock} onCreated={onUnlocked} onBack={Object.keys(lock.projects).length ? () => setMode('sign-in') : undefined} />
      )}
    </div>
  );
}

function Brand({ subtitle }: { subtitle: string }) {
  return (
    <div className="row">
      <div className="brand-mark" style={{ width: 40, height: 40, borderRadius: 10 }}>
        <NotebookPen size={22} />
      </div>
      <div>
        <h1 style={{ margin: 0 }}>Project log book</h1>
        <p className="muted" style={{ margin: 0 }}>
          {subtitle}
        </p>
      </div>
    </div>
  );
}

function SignIn({ lock, onUnlocked, onCreate }: { lock: LockInfo; onUnlocked: () => void; onCreate: () => void }) {
  const projects = listProjects(lock);
  const last = getPref<string | null>('project', null);
  const [projectId, setProjectId] = useState(() => projects.find((p) => p.id === last)?.id ?? (projects.length === 1 ? projects[0].id : ''));
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!projectId || !password || busy) return;
    setBusy(true);
    setError(null);
    const key = await unlockProject(lock, projectId, password).catch(() => null);
    if (!key) {
      setBusy(false);
      setError('Wrong password for this project.');
      return;
    }
    await startSession(new Map([[projectId, key]]), remember);
    setPref('project', projectId);
    // Opening "Create a project" already started the store with nothing unlocked: start again from the files.
    if (store.getStatus().ready) location.reload();
    else onUnlocked();
  };

  return (
    <form className="card card-pad stack" onSubmit={submit}>
      <Brand subtitle="Choose your project and enter its password" />
      <ProjectSelect id="login-project" projects={projects} value={projectId} onChange={(id) => (setProjectId(id), setError(null))} />
      <PasswordField id="login-password" label="Password" value={password} onChange={setPassword} autoComplete="current-password" autoFocus={!!projectId} error={error} />
      <label className="row small">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        Keep me signed in on this device
      </label>
      <button className="btn primary" type="submit" disabled={busy || !projectId || !password}>
        <LockKeyhole size={16} /> {busy ? 'Checking…' : 'Sign in'}
      </button>
      <div className="login-footer">
        <span className="small muted">Starting something new?</span>
        <button type="button" className="btn ghost small" onClick={onCreate}>
          <Plus size={15} /> Create a project
        </button>
      </div>
    </form>
  );
}

function CreateProject({ lock, onCreated, onBack }: { lock: LockInfo; onCreated: () => void; onBack?: () => void }) {
  const [choice, setChoice] = useState(TEMPLATES[TEMPLATES.length - 1].key);
  const [name, setName] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = useSaveStatus();
  const template = TEMPLATES.find((t) => t.key === choice)!;

  // Find out where a new project can be saved (dev server or connected folder), with nothing unlocked yet.
  useEffect(() => {
    if (!getDataKeys()) setDataKeys(new Map());
    void store.init();
  }, []);
  const problem = status.ready ? cannotSaveNewProject() : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const projectName = name.trim() || template.project.name || 'New project';
    if (password.length < MIN_PASSWORD) return setError(`Use at least ${MIN_PASSWORD} characters for the project password.`);
    if (password !== confirm) return setError('The two project passwords are different.');
    setBusy(true);
    setError(null);
    try {
      const id = await createLockedProject(lock, template, { name: projectName, password, adminPassword });
      setPref('project', id);
      onCreated();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const folderAction = async (action: () => Promise<void>) => {
    try {
      await action();
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setError((err as Error).message);
    }
  };

  let blocked: ReactNode = null;
  if (!lock.admin) {
    blocked = (
      <div className="notice warn">
        <span>
          No admin password is set yet. Run <code>npm run lock</code> in the repo to set one, then reload this page.
        </span>
      </div>
    );
  } else if (problem) {
    blocked = (
      <div className="notice warn stack">
        <span>New projects are saved into the repo’s data folder. {problem}</span>
        {status.folderNeedsPermission && (
          <button type="button" className="btn small" onClick={() => void folderAction(() => store.reconnectFolder())}>
            <FolderOpen size={15} /> Allow access to the data folder
          </button>
        )}
        {!status.folderNeedsPermission && status.folderSupported && (
          <button type="button" className="btn small" onClick={() => void folderAction(() => store.connectFolder())}>
            <FolderOpen size={15} /> Connect data folder
          </button>
        )}
      </div>
    );
  }

  return (
    <form className="card card-pad stack" onSubmit={submit}>
      <Brand subtitle="Create a project (admin only)" />
      {blocked}
      <fieldset className="stack bare" disabled={!!blocked || !status.ready || busy}>
        <PasswordField
          id="create-admin"
          label="Admin password"
          value={adminPassword}
          onChange={setAdminPassword}
          autoComplete="current-password"
          autoFocus
          hint="Only admins can create projects. It does not open any project."
        />
        <div className="field">
          <label htmlFor="create-name">Project name</label>
          <input id="create-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={template.project.name || 'New project'} />
          <span className="hint">Shown on this sign-in page, so anyone can see it. Everything inside the project stays encrypted.</span>
        </div>
        <div className="field">
          <label htmlFor="create-template">Start from</label>
          <select id="create-template" value={choice} onChange={(e) => setChoice(e.target.value)}>
            {TEMPLATES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
          {template.description && <span className="hint">{template.description}</span>}
        </div>
        <PasswordField
          id="create-password"
          label="Password for this project"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          hint="Give it only to the people on this project. Use a long, random one."
        />
        <PasswordField id="create-confirm" label="Type it again" value={confirm} onChange={setConfirm} autoComplete="new-password" error={error} />
        <button className="btn primary" type="submit" disabled={!adminPassword || !password || !confirm}>
          <Plus size={16} /> {busy ? 'Creating…' : 'Create project'}
        </button>
      </fieldset>
      {error && !!blocked && (
        <span className="login-error" role="alert">
          {error}
        </span>
      )}
      {onBack && (
        <div className="login-footer">
          <button type="button" className="btn ghost small" onClick={onBack}>
            <ArrowLeft size={15} /> Back to sign-in
          </button>
        </div>
      )}
    </form>
  );
}

/** Shown instead of the login page when data/lock.json still uses the old single password. */
export function OutdatedLockPage() {
  return (
    <div className="login">
      <div className="card card-pad stack">
        <h1 style={{ margin: 0 }}>Project log book</h1>
        <p>
          This log book is still locked with one password for everything. Run <code>npm run lock</code> in the repo to give each project its own
          password, then commit <code>data/</code>.
        </p>
      </div>
    </div>
  );
}

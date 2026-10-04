import { useState, type FormEvent } from 'react';
import { LockKeyhole, NotebookPen } from 'lucide-react';
import { startSession } from '../app/auth.ts';
import { PasswordField } from '../components/PasswordField.tsx';
import { unlockProjects, type LockInfo } from '../lib/lock.ts';

/** Shown before anything else on a password-protected log book. Each project has its own password. */
export function LoginPage({ lock, onUnlocked }: { lock: LockInfo; onUnlocked: () => void }) {
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    const keys = await unlockProjects(lock, password).catch(() => null);
    if (!keys?.size) {
      setBusy(false);
      setError('Wrong password.');
      return;
    }
    await startSession(keys, remember);
    onUnlocked();
  };

  return (
    <div className="login">
      <form className="card card-pad stack" onSubmit={submit}>
        <div className="row">
          <div className="brand-mark" style={{ width: 40, height: 40, borderRadius: 10 }}>
            <NotebookPen size={22} />
          </div>
          <div>
            <h1 style={{ margin: 0 }}>Project log book</h1>
            <p className="muted" style={{ margin: 0 }}>
              Sign in with your project’s password
            </p>
          </div>
        </div>
        <PasswordField
          id="login-password"
          label="Project password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          autoFocus
          error={error}
        />
        <label className="row small">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Keep me signed in on this device
        </label>
        <button className="btn primary" type="submit" disabled={busy || !password}>
          <LockKeyhole size={16} /> {busy ? 'Checking…' : 'Sign in'}
        </button>
      </form>
    </div>
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

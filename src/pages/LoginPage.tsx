import { useState, type FormEvent } from 'react';
import { LockKeyhole, NotebookPen } from 'lucide-react';
import { startSession } from '../app/auth.ts';
import { unlock, type LockInfo } from '../lib/lock.ts';

/** Shown before anything else on a password-protected site. */
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
    const key = await unlock(lock, password).catch(() => null);
    if (!key) {
      setBusy(false);
      setError('Wrong password.');
      return;
    }
    await startSession(key, remember);
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
              Admin sign-in
            </p>
          </div>
        </div>
        <div className="field">
          <label htmlFor="login-password">Password</label>
          <input
            id="login-password"
            type="password"
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={!!error}
            aria-describedby={error ? 'login-error' : undefined}
          />
          {error && (
            <span id="login-error" className="login-error" role="alert">
              {error}
            </span>
          )}
        </div>
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

import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { Eye, EyeOff, LockKeyhole, NotebookPen } from 'lucide-react';
import { startSession } from '../app/auth.ts';
import { unlock, type LockInfo } from '../lib/lock.ts';

/** Shown before anything else on a password-protected site. */
export function LoginPage({ lock, onUnlocked }: { lock: LockInfo; onUnlocked: () => void }) {
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Shows the password only while the eye button is held down (mouse, touch, or Space/Enter).
  const [peek, setPeek] = useState(false);
  const holdKey = (e: KeyboardEvent, down: boolean) => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault();
    setPeek(down);
  };

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
          <div className="password-field">
            <input
              id="login-password"
              type={peek ? 'text' : 'password'}
              autoComplete="current-password"
              autoCapitalize="off"
              spellCheck={false}
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={!!error}
              aria-describedby={error ? 'login-error' : undefined}
            />
            <button
              type="button"
              className="peek"
              aria-label="Hold to show password"
              aria-pressed={peek}
              title="Hold to show password"
              // Keep focus in the field so typing can continue after peeking.
              onPointerDown={(e) => {
                e.preventDefault();
                setPeek(true);
              }}
              onPointerUp={() => setPeek(false)}
              onPointerLeave={() => setPeek(false)}
              onPointerCancel={() => setPeek(false)}
              onKeyDown={(e) => holdKey(e, true)}
              onKeyUp={(e) => holdKey(e, false)}
              onBlur={() => setPeek(false)}
              onContextMenu={(e) => e.preventDefault()}
            >
              {peek ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
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

import { useState, type KeyboardEvent } from 'react';
import { Eye, EyeOff } from 'lucide-react';

interface Props {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: 'current-password' | 'new-password';
  autoFocus?: boolean;
  error?: string | null;
  hint?: string;
}

/** A password input whose text shows only while the eye button is held down (mouse, touch, or Space/Enter). */
export function PasswordField({ id, label, value, onChange, autoComplete, autoFocus, error, hint }: Props) {
  const [peek, setPeek] = useState(false);
  const holdKey = (e: KeyboardEvent, down: boolean) => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault();
    setPeek(down);
  };
  const errorId = `${id}-error`;

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="password-field">
        <input
          id={id}
          type={peek ? 'text' : 'password'}
          autoComplete={autoComplete}
          autoCapitalize="off"
          spellCheck={false}
          autoFocus={autoFocus}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={!!error}
          aria-describedby={error ? errorId : undefined}
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
      {hint && !error && <span className="hint">{hint}</span>}
      {error && (
        <span id={errorId} className="login-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

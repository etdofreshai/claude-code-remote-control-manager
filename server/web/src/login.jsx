// Login screen restyled to match the Harness Eclipse-dark theme.

import { login } from './api/client.js';

const { useState } = React;

const theme = {
  bg: '#0a0a0c',
  surface: '#111114',
  surface2: '#16161b',
  border: 'rgba(255,255,255,0.08)',
  borderStrong: 'rgba(255,255,255,0.14)',
  text: '#e5e5e7',
  textDim: '#8a8a93',
  textMuted: '#55555c',
  accent: '#7c83f0',
  accentSoft: 'rgba(124,131,240,0.16)',
  danger: '#f06363',
};

export function Login({ onSuccess }) {
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');

  async function onSubmit(e) {
    e.preventDefault();
    if (submitting) return;
    setErr('');
    setSubmitting(true);
    try {
      await login(password);
      onSuccess?.();
    } catch (e2) {
      setErr(e2?.message || 'Wrong password');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0,
        background: theme.bg,
        color: theme.text,
        fontFamily: '"Inter", -apple-system, system-ui, sans-serif',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div style={{
        position: 'absolute', top: 24, left: 28,
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: 13, color: theme.textMuted, letterSpacing: '-0.005em',
      }}>
        <span style={{ color: theme.accent }}>#</span> harness
      </div>

      <form
        onSubmit={onSubmit}
        style={{
          width: '100%', maxWidth: 360,
          background: theme.surface,
          border: `1px solid ${theme.border}`,
          borderRadius: 7,
          padding: 28,
          boxShadow: '0 24px 60px rgba(0,0,0,0.4)',
        }}
      >
        <h1 style={{
          margin: '0 0 4px',
          fontSize: 18, fontWeight: 600, letterSpacing: '-0.015em',
        }}>
          Sign in
        </h1>
        <p style={{
          margin: '0 0 20px',
          color: theme.textDim,
          fontSize: 12.5, lineHeight: 1.5,
        }}>
          Enter the UI password to access the Harness console.
        </p>

        <label style={{
          display: 'block',
          fontSize: 11, fontWeight: 500,
          color: theme.textMuted, marginBottom: 6,
          textTransform: 'uppercase', letterSpacing: '0.06em',
        }}>
          Password
        </label>
        <input
          type="password"
          name="password"
          autoFocus
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{
            width: '100%',
            background: theme.surface2,
            border: `1px solid ${theme.borderStrong}`,
            borderRadius: 5,
            padding: '9px 11px',
            color: theme.text,
            fontSize: 13.5,
            fontFamily: 'inherit',
            outline: 'none',
            boxSizing: 'border-box',
          }}
          onFocus={(e) => { e.currentTarget.style.borderColor = theme.accent; }}
          onBlur={(e) => { e.currentTarget.style.borderColor = theme.borderStrong; }}
        />

        {err && (
          <p style={{
            margin: '12px 0 0',
            fontSize: 12,
            color: theme.danger,
          }}>
            {err}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting || !password}
          style={{
            marginTop: 18,
            width: '100%',
            background: submitting || !password ? theme.accentSoft : theme.accent,
            color: submitting || !password ? theme.textDim : '#fff',
            border: 'none',
            borderRadius: 5,
            padding: '10px 14px',
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: '-0.005em',
            cursor: submitting || !password ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <div style={{
        position: 'absolute', bottom: 18,
        fontSize: 11, color: theme.textMuted,
        fontFamily: '"JetBrains Mono", monospace',
      }}>
        claude-code-remote-control-manager
      </div>
    </div>
  );
}

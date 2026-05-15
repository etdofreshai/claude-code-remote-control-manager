// Entry point. Order matters:
//   1) globals.js installs React/ReactDOM on globalThis so the legacy
//      IIFE component files can read them.
//   2) Each component file is imported for side effects — they attach
//      symbols like window.Icons, window.Harness, window.useTweaks.
//   3) We then pull those off window and render the App.

import './globals.js';

import './components/harness-theme.js';
import './components/tweaks-panel.jsx';
import './components/harness-icons.jsx';
import './components/harness-providers.jsx';
import './components/harness-sidebar.jsx';
import './components/harness-chat.jsx';
import './components/harness-input.jsx';
import './components/harness-launcher.jsx';
import './components/harness-settings.jsx';
import './components/harness.jsx';

import { hasToken } from './api/client.js';
import { useHarnessData } from './api/use-harness-data.js';
import { useTranscript } from './api/use-transcript.js';
import { makeActions } from './api/actions.js';
import { Login } from './login.jsx';

// Expose the transcript hook to the IIFE-style component bundle.
window.useTranscript = useTranscript;

const { useState, useMemo } = React;

const TWEAK_DEFAULTS = {
  variant: 'Eclipse',
  dark: true,
  density: 'compact',
  sidebar: true,
  bubble: false,
};

function App() {
  const useTweaks = window.useTweaks;
  const TweaksPanel = window.TweaksPanel;
  const TweakSection = window.TweakSection;
  const TweakRadio = window.TweakRadio;
  const TweakToggle = window.TweakToggle;
  const Harness = window.Harness;

  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const { data, error, refresh } = useHarnessData();

  const harnessActions = useMemo(() => {
    const api = makeActions({ refresh });
    return {
      onSend: (session, text) => api.sendMessage(session.clientName, session.sessionId, text),
      // /message accepts any user-supplied content; "steer" is just a queued
      // user message for an in-flight session.
      onSteer: (session, text) => api.sendMessage(session.clientName, session.sessionId, text),
      // Kill / Stop the running session by flipping enabled=false on the server.
      onStop: (session) => api.setEnabled(session.clientName, session.sessionId, false),
      onKill: (session) => api.setEnabled(session.clientName, session.sessionId, false),
      onRevive: (session) => api.setEnabled(session.clientName, session.sessionId, true),
      onArchiveSession: (session) => api.setEnabled(session.clientName, session.sessionId, false),
      onDeleteSession: (session) => api.deleteSession(session.clientName, session.sessionId),
      onRenameSession: (session, name) => api.rename(session.clientName, session.sessionId, name),
      onSwitchModel: (session, provider, model, effort) =>
        api.switchSession(session.clientName, session.sessionId, { provider, model, effort }),
      onCreateSession: async (opts = {}) => {
        const env = opts.env || (data?.environments?.find((e) => e.connected && e.enabled)?.id);
        if (!env) throw new Error('No environment selected and none online');
        const cwd = opts.cwd || '~';
        const result = await api.createSession(env, {
          workingDirectory: cwd,
          provider: opts.provider,
          model: opts.model,
        });
        const newSessionId = result?.sessionId || result?.id;
        if (opts.text && newSessionId) {
          await api.sendMessage(env, newSessionId, opts.text);
        }
        return { clientName: env, sessionId: newSessionId };
      },
      // Bind mode: list on-disk sessions for an env+directory (the `list`
      // agent command) so the launcher can offer untracked ones to adopt.
      onListSessions: async (env, workingDirectory) => {
        const r = await api.listAgentSessions(env, { workingDirectory, pageSize: 100 });
        return r?.items || [];
      },
      // Adopt an existing on-disk session via the real bindSession API.
      onBindSession: async ({ env, cwd, sessionId }) => {
        const result = await api.bindSession(env, { workingDirectory: cwd, sessionId });
        return { clientName: env, sessionId: result?.sessionId || sessionId };
      },
    };
  }, [refresh, data?.environments]);

  if (data == null) {
    return (
      <div style={{
        position: 'fixed', inset: 0,
        background: '#0a0a0c', color: '#8a8a93',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: '"JetBrains Mono", monospace', fontSize: 13,
      }}>
        loading…
      </div>
    );
  }

  return (
    <>
      <Harness tweaks={t} setTweak={setTweak} data={data} actions={harnessActions} />
      <TweaksPanel>
        <TweakSection label="Appearance" />
        <TweakRadio
          label="Variant"
          value={t.variant}
          options={['Eclipse', 'Ember', 'Console']}
          onChange={(v) => setTweak('variant', v)}
        />
        <TweakToggle label="Dark mode" value={t.dark} onChange={(v) => setTweak('dark', v)} />
        <TweakRadio
          label="Density"
          value={t.density}
          options={['compact', 'comfy']}
          onChange={(v) => setTweak('density', v)}
        />
        <TweakSection label="Layout" />
        <TweakToggle label="Show sidebar" value={t.sidebar} onChange={(v) => setTweak('sidebar', v)} />
        <TweakRadio
          label="Messages"
          value={t.bubble ? 'bubble' : 'flat'}
          options={['flat', 'bubble']}
          onChange={(v) => setTweak('bubble', v === 'bubble')}
        />
      </TweaksPanel>
    </>
  );
}

function Root() {
  const [authed, setAuthed] = useState(hasToken());
  if (!authed) {
    return <Login onSuccess={() => setAuthed(true)} />;
  }
  return <App />;
}

ReactDOM.createRoot(document.getElementById('root')).render(<Root />);

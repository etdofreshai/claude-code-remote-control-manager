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
import { Login } from './login.jsx';

const { useState } = React;

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
  const { data, error } = useHarnessData();

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
      <Harness tweaks={t} setTweak={setTweak} data={data} />
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

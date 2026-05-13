// Fetches real data from the CCRCM server and shapes it into the structure
// the Harness UI expects (sessions, environments, chats, gitRepos,
// activeSessionId). For fields the server doesn't have yet (tokens, cost,
// branch, message counts) we fall back to sensible defaults.

import { apiFetch } from './client.js';

const { useState, useEffect, useRef } = React;

const REFRESH_MS = 10_000;

function mapStatus(s) {
  if (!s) return 'idle';
  if (s.enabled === false) return 'closed';
  switch (s.status) {
    case 'running':
    case 'starting':
      return 'running';
    case 'awaiting':
      return 'awaiting';
    case 'completed':
      return 'completed';
    case 'error':
    case 'failed':
      return 'failed';
    case 'disabled':
    case 'closed':
      return 'closed';
    case 'idle':
    default:
      return 'idle';
  }
}

function mapPlatform(p) {
  const s = String(p ?? '').toLowerCase();
  if (s.startsWith('win')) return 'windows';
  return 'unix';
}

function mapProvider(p) {
  const s = String(p ?? '').toLowerCase();
  if (s.includes('codex') || s.includes('openai') || s.startsWith('gpt')) return 'codex';
  if (s.includes('gemini') || s.includes('google')) return 'gemini';
  return 'claude';
}

function shape(agents) {
  const ENVIRONMENTS = (agents ?? []).map((a) => ({
    id: a.name,
    name: a.name,
    host: a.hostname || a.name,
    os: a.platform || 'unknown',
    platform: mapPlatform(a.platform),
    cpu: '—',
    mem: '—',
    connected: !!a.online,
    enabled: true,
    connectedAt: Date.parse(a.lastSeenAt) || Date.now(),
    tools: [],
    default: false,
  }));

  const SESSIONS = [];
  for (const a of agents ?? []) {
    for (const s of a.sessions ?? []) {
      SESSIONS.push({
        id: `${a.name}:${s.sessionId}`,
        clientName: a.name,
        sessionId: s.sessionId,
        cwd: s.workingDirectory || '~',
        branch: null,
        env: a.name,
        title: s.name || s.sessionId,
        status: mapStatus(s),
        provider: mapProvider(s.provider),
        model: s.model || '—',
        tokens: 0,
        cost: 0,
        updated: Date.parse(s.lastMessageAt || s.addedAt) || Date.now(),
        created: Date.parse(s.addedAt) || Date.now(),
        msgs: 0,
        enabled: s.enabled !== false,
      });
    }
  }

  return {
    sessions: SESSIONS,
    environments: ENVIRONMENTS,
    chats: {},
    gitRepos: [],
    activeSessionId: SESSIONS[0]?.id ?? null,
  };
}

export function useHarnessData() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const aliveRef = useRef(true);
  const loadRef = useRef(null);

  useEffect(() => {
    aliveRef.current = true;
    let timer;
    async function load() {
      try {
        const agents = await apiFetch('/api/clients');
        if (!aliveRef.current) return;
        setData(shape(agents));
        setError(null);
      } catch (err) {
        if (!aliveRef.current) return;
        console.error('useHarnessData: load failed', err);
        setError(err);
        // First-load failure: render empty shell instead of perpetual spinner.
        setData((prev) => prev ?? shape([]));
      }
    }
    loadRef.current = load;
    load();
    timer = setInterval(load, REFRESH_MS);
    return () => {
      aliveRef.current = false;
      loadRef.current = null;
      clearInterval(timer);
    };
  }, []);

  // Stable refresh handle that callers (actions.js) can poke after a mutation
  // to skip the 10 s polling delay.
  const refresh = () => { loadRef.current && loadRef.current(); };

  return { data, error, refresh };
}

// Mock data for the AI session harness prototype.

window.HARNESS_DATA = (function () {
  const now = Date.now();
  const m = (n) => now - n * 60 * 1000;
  const h = (n) => now - n * 60 * 60 * 1000;

  const SESSIONS = [
    // ~/code/web-app
    {
      id: 's1', cwd: '~/code/web-app', branch: 'fix/auth-redirect', env: 'local',
      title: 'Fix auth redirect on refresh',
      status: 'running', provider: 'claude', model: 'sonnet',
      tokens: 47210, cost: 0.42, updated: m(0), created: m(18), msgs: 18,
    },
    {
      id: 's2', cwd: '~/code/web-app', branch: 'feat/dashboard', env: 'local',
      title: 'Refactor user dashboard components',
      status: 'awaiting', provider: 'claude', model: 'opus',
      tokens: 128430, cost: 2.31, updated: m(8), created: h(28), msgs: 32,
    },
    {
      id: 's3', cwd: '~/code/web-app', branch: 'main', env: 'staging-vm',
      title: 'Add dark mode support',
      status: 'completed', provider: 'codex', model: 'gpt-5.5',
      tokens: 92140, cost: 0.88, updated: h(2), created: h(8), msgs: 21,
    },
    // ~/code/api-server
    {
      id: 's4', cwd: '~/code/api-server', branch: 'perf/db-queries', env: 'staging-vm',
      title: 'Optimize slow query in /search endpoint',
      status: 'idle', provider: 'claude', model: 'sonnet',
      tokens: 18290, cost: 0.16, updated: h(5), created: h(48), msgs: 8,
    },
    {
      id: 's5', cwd: '~/code/api-server', branch: 'chore/postgres-16', env: 'mac-mini',
      title: 'Migrate to PostgreSQL 16',
      status: 'failed', provider: 'gemini', model: 'pro-3-1-preview',
      tokens: 71820, cost: 0.61, updated: h(9), created: h(72), msgs: 19,
      error: 'Tool execution failed: pg_dump exited with code 2',
    },
    // ~/code/docs-site
    {
      id: 's6', cwd: '~/code/docs-site', branch: 'main', env: 'local',
      title: 'Update API reference for v3',
      status: 'closed', provider: 'claude', model: 'haiku',
      tokens: 24108, cost: 0.07, updated: h(26), created: h(120), msgs: 12,
    },
    // General chats — not tied to a workspace, no env
    {
      id: 'c1', cwd: 'Chats', branch: null, env: null, mode: 'chat',
      title: 'Brainstorm names for the new product',
      status: 'idle', provider: 'claude', model: 'opus',
      tokens: 8420, cost: 0.18, updated: h(3), created: h(12), msgs: 16,
    },
    {
      id: 'c2', cwd: 'Chats', branch: null, env: null, mode: 'chat',
      title: 'Explain rust lifetimes',
      status: 'completed', provider: 'codex', model: 'gpt-5.5',
      tokens: 11240, cost: 0.09, updated: h(20), created: h(96), msgs: 9,
    },
  ];

  const ENVIRONMENTS = [
    {
      id: 'local', name: 'local', host: '127.0.0.1', os: 'macOS 14.5', platform: 'unix',
      cpu: 'M2 Pro · 10 cores', mem: '32 GB',
      connected: true, enabled: true,
      connectedAt: m(1240), tools: ['filesystem', 'shell', 'tests'], default: true,
    },
    {
      id: 'staging-vm', name: 'staging-vm', host: '10.0.4.18', os: 'Ubuntu 22.04', platform: 'unix',
      cpu: 'x86_64 · 8 cores', mem: '16 GB',
      connected: true, enabled: true,
      connectedAt: m(840), tools: ['filesystem', 'shell', 'tests', 'docker'],
    },
    {
      id: 'mac-mini', name: 'mac-mini', host: '192.168.1.42', os: 'macOS 14.4', platform: 'unix',
      cpu: 'M2 · 8 cores', mem: '16 GB',
      connected: false, enabled: true,
      connectedAt: h(72), tools: ['filesystem', 'shell'],
    },
    {
      id: 'gpu-box', name: 'gpu-box', host: '10.0.4.99', os: 'Ubuntu 22.04', platform: 'unix',
      cpu: 'x86_64 · 16 cores · 2× RTX 4090', mem: '128 GB',
      connected: true, enabled: false,
      connectedAt: m(220), tools: ['filesystem', 'shell', 'tests', 'cuda'],
    },
    {
      id: 'win-dev', name: 'win-dev', host: '10.0.4.22', os: 'Windows 11', platform: 'windows',
      cpu: 'x86_64 · 12 cores', mem: '32 GB',
      connected: true, enabled: true,
      connectedAt: m(95), tools: ['filesystem', 'shell', 'tests'],
    },
  ];

  // Chat log for s1 — running session, lots of varied state.
  const CHAT_S1 = [
    { role: 'user', time: m(14), kind: 'text',
      text: "Users are getting bounced to /login on page refresh even though their session is valid. Can you take a look at the auth flow?" },

    { role: 'user', time: m(14), kind: 'attachment',
      attachments: [
        { type: 'image', name: 'bug-repro.png', size: '184 KB' },
        { type: 'file', name: 'console.log', size: '2.1 KB', preview: '[14:02:31] GET /api/me → 200 OK\n[14:02:31] navigate → /login  ← unexpected\n[14:02:31] hydrating auth store…' },
      ],
    },

    { role: 'assistant', time: m(13), kind: 'thinking', collapsed: true,
      summary: 'Tracing the refresh → auth check path',
      text: "Let me start by understanding the auth flow. On refresh, the app likely hydrates state from somewhere — localStorage, a cookie, or a /me call. If that hydration is racing the route guard, the guard might fire with no user yet and redirect. I should read the auth store and the router guard first." },

    { role: 'assistant', time: m(13), kind: 'tool', tool: 'read_file',
      args: { path: 'src/stores/auth.ts' }, status: 'ok',
      duration: '34ms',
      result: `import { create } from 'zustand';\nimport { persist } from 'zustand/middleware';\n\nexport const useAuth = create(\n  persist(\n    (set) => ({\n      user: null,\n      hydrated: false,\n      setUser: (user) => set({ user, hydrated: true }),\n      clear: () => set({ user: null, hydrated: true }),\n    }),\n    { name: 'auth' }\n  )\n);` },

    { role: 'assistant', time: m(12), kind: 'tool', tool: 'read_file',
      args: { path: 'src/router/guards.ts' }, status: 'ok',
      duration: '12ms',
      result: `import { useAuth } from '@/stores/auth';\n\nexport function requireAuth(to, from, next) {\n  const { user } = useAuth.getState();\n  if (!user) return next('/login');\n  return next();\n}` },

    { role: 'assistant', time: m(12), kind: 'tool', tool: 'bash',
      args: { cmd: 'grep -rn "requireAuth" src/' }, status: 'ok',
      duration: '0.18s',
      result: `src/router/index.ts:14:  beforeEach: requireAuth,\nsrc/router/guards.ts:3:export function requireAuth(to, from, next) {\nsrc/router/__tests__/guards.test.ts:8:  describe('requireAuth', () => {` },

    { role: 'assistant', time: m(11), kind: 'text',
      text: "Found it. `requireAuth` reads `user` synchronously, but on refresh Zustand's persist middleware hasn't rehydrated from localStorage yet — so `user` is `null` for the first tick and the guard redirects to `/login`. The store exposes a `hydrated` flag for exactly this case, but the guard isn't using it.\n\nI want to make this change. It writes to `src/router/guards.ts`:" },

    { role: 'assistant', time: m(11), kind: 'permission',
      title: 'Approve file edit',
      tool: 'edit_file',
      target: 'src/router/guards.ts',
      summary: '12 lines changed (+9 −3)',
      options: ['Approve', 'Approve & remember', 'Reject'],
      decision: 'Approve',
    },

    { role: 'assistant', time: m(10), kind: 'tool', tool: 'edit_file',
      args: { path: 'src/router/guards.ts' }, status: 'ok',
      duration: '47ms',
      diff: [
        { type: 'ctx', text: "import { useAuth } from '@/stores/auth';" },
        { type: 'ctx', text: '' },
        { type: 'del', text: 'export function requireAuth(to, from, next) {' },
        { type: 'del', text: '  const { user } = useAuth.getState();' },
        { type: 'del', text: "  if (!user) return next('/login');" },
        { type: 'add', text: 'export async function requireAuth(to, from, next) {' },
        { type: 'add', text: '  const state = useAuth.getState();' },
        { type: 'add', text: '  if (!state.hydrated) {' },
        { type: 'add', text: '    await new Promise((r) => useAuth.persist.onFinishHydration(r));' },
        { type: 'add', text: '  }' },
        { type: 'add', text: "  const { user } = useAuth.getState();" },
        { type: 'add', text: "  if (!user) return next('/login');" },
        { type: 'ctx', text: '  return next();' },
        { type: 'ctx', text: '}' },
      ] },

    { role: 'assistant', time: m(8), kind: 'tool', tool: 'bash',
      args: { cmd: 'pnpm typecheck' }, status: 'fail',
      duration: '4.2s',
      error: "src/router/guards.ts(7,11): error TS2339: Property 'persist' does not exist on type 'UseBoundStore<...>'",
      result: ` ERR  TypeScript compilation failed (1 error)\nsrc/router/guards.ts:7:11 — Property 'persist' does not exist on type 'UseBoundStore'.`,
    },

    { role: 'assistant', time: m(7), kind: 'text',
      text: "Typecheck failed — `persist` isn't on the store's type. I need to use the typed import from zustand/middleware instead." },

    { role: 'assistant', time: m(7), kind: 'tool', tool: 'edit_file',
      args: { path: 'src/router/guards.ts' }, status: 'ok',
      duration: '22ms',
      diff: [
        { type: 'ctx', text: "import { useAuth } from '@/stores/auth';" },
        { type: 'add', text: "import { onHydrate } from '@/stores/auth';" },
        { type: 'ctx', text: '' },
        { type: 'ctx', text: 'export async function requireAuth(to, from, next) {' },
        { type: 'del', text: '  if (!state.hydrated) {' },
        { type: 'del', text: '    await new Promise((r) => useAuth.persist.onFinishHydration(r));' },
        { type: 'del', text: '  }' },
        { type: 'add', text: '  if (!state.hydrated) await onHydrate();' },
      ] },

    { role: 'assistant', time: m(6), kind: 'tool', tool: 'run_tests',
      args: { suite: 'auth' }, status: 'ok',
      duration: '1.28s',
      result: ` PASS  src/router/__tests__/guards.test.ts\n  requireAuth\n    ✓ waits for hydration before redirecting (42 ms)\n    ✓ allows authenticated users through (8 ms)\n    ✓ redirects unauthenticated users to /login (6 ms)\n\nTest Suites: 1 passed, 1 total\nTests:       3 passed, 3 total\nTime:        1.284 s` },

    { role: 'assistant', time: m(5), kind: 'tool', tool: 'screenshot',
      args: { url: 'localhost:3000/dashboard', action: 'reload' }, status: 'ok',
      duration: '2.1s',
      image: 'dashboard' },

    { role: 'assistant', time: m(4), kind: 'progress',
      label: 'Indexing modified files',
      pct: 64, current: 41, total: 64,
    },

    { role: 'assistant', time: m(3), kind: 'text', streaming: true,
      text: "Refresh now keeps you on `/dashboard` — the guard awaits the persisted store before evaluating. I added a regression test covering the race and the typecheck is green.\n\nWant me to check whether any other guards have the same pattern" },
  ];

  return {
    sessions: SESSIONS,
    environments: ENVIRONMENTS,
    chats: { s1: CHAT_S1 },
    // CWDs that are git repos (have a .git folder). Drives whether the branch
    // dropdown appears in the launcher and status bar.
    gitRepos: ['~/code/web-app', '~/code/api-server', '~/code/docs-site'],
    activeSessionId: 's1',
  };
})();

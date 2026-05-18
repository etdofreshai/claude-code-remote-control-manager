export interface HelpEndpoint {
  method: string;
  path: string;
  auth: "none" | "bearer" | "claude.ai session";
  description: string;
  body?: Record<string, string>;
}

export const ccrcEndpoints: HelpEndpoint[] = [
  { method: "GET", path: "/healthz", auth: "none", description: "Public health check." },
  { method: "GET", path: "/help", auth: "none", description: "Human-readable CCRC and Claude.ai remote-control API notes." },
  { method: "GET", path: "/api/help", auth: "bearer", description: "Machine-readable endpoint inventory and remote-control notes." },
  { method: "GET", path: "/api/clients", auth: "bearer", description: "List known clients, online state, reported sessions, and desired sessions." },
  { method: "GET", path: "/api/clients/:name", auth: "bearer", description: "Inspect one client by name." },
  { method: "GET", path: "/api/clients/:name/sessions", auth: "bearer", description: "List desired and reported sessions for one client." },
  { method: "POST", path: "/api/clients/:name/sessions/list", auth: "bearer", description: "Ask a connected client to refresh/list local Claude sessions." },
  {
    method: "POST",
    path: "/api/clients/:name/sessions/new",
    auth: "bearer",
    description: "Start a new Claude Code session on a connected client and enable remote control.",
    body: { cwd: "Required local working directory on the client", name: "Optional title", text: "Optional initial prompt" },
  },
  {
    method: "POST",
    path: "/api/clients/:name/sessions/resume",
    auth: "bearer",
    description: "Resume/bind an existing local Claude Code session on a connected client and enable remote control.",
    body: { cwd: "Required real local working directory on the client", sessionId: "Required local Claude Code session id", name: "Optional title" },
  },
  { method: "POST", path: "/api/clients/:name/sessions/:sessionId/message", auth: "bearer", description: "Send a text message to a running client-managed session.", body: { text: "Required message text" } },
  { method: "POST", path: "/api/clients/:name/sessions/:sessionId/stop", auth: "bearer", description: "Stop a running client-managed session and disable remote control." },
  { method: "POST", path: "/api/clients/:name/disconnect", auth: "bearer", description: "Ask a connected client to disconnect." },
  { method: "POST", path: "/api/agent/connect", auth: "bearer", description: "Client connect endpoint." },
  { method: "POST", path: "/api/agent/sessions", auth: "bearer", description: "Client reports local sessions discovered on its machine." },
  { method: "GET", path: "/api/agent/poll", auth: "bearer", description: "Client long-polls for queued commands." },
  { method: "POST", path: "/api/agent/ack", auth: "bearer", description: "Client acknowledges a command result." },
  { method: "POST", path: "/api/agent/disconnect", auth: "bearer", description: "Client disconnect notification." },
];

export const claudeAiRemoteEndpoints: HelpEndpoint[] = [
  { method: "GET", path: "https://claude.ai/v1/sessions", auth: "claude.ai session", description: "List Claude.ai sessions; supports after_id pagination." },
  { method: "GET", path: "https://claude.ai/v1/sessions/:session_id", auth: "claude.ai session", description: "Fetch one Claude.ai session's metadata, including title, connection_status, tags, and branch metadata." },
  { method: "GET", path: "https://claude.ai/v1/sessions/:session_id/events", auth: "claude.ai session", description: "Fetch session event history; supports limit and after_id." },
  { method: "GET", path: "https://claude.ai/v1/sessions/ws/:session_id/subscribe", auth: "claude.ai session", description: "Websocket used by Claude.ai for live remote-control events and responses." },
  { method: "POST", path: "https://claude.ai/v1/sessions/:session_id/events", auth: "claude.ai session", description: "Claude.ai web posts user events/messages to a remote session." },
  { method: "POST", path: "https://claude.ai/v1/code/sessions/:control_session_id/client/presence", auth: "claude.ai session", description: "Claude.ai web marks the browser client present for a control session; observed response includes refresh_after_seconds." },
  { method: "POST", path: "https://claude.ai/v1/code/github/batch-branch-status", auth: "claude.ai session", description: "Batch checks GitHub repo/branch/PR status for code sessions." },
  { method: "POST", path: "https://claude.ai/v1/session_ingress/session/:session_id/git_proxy/compare", auth: "claude.ai session", description: "Git compare helper used by Claude.ai for code-session branch diffs." },
];

export const remoteOperatorPrompt = `You are running as a remote-controlled Claude Code session on my machine.

Before changing anything, orient yourself and report:
1. Current working directory (pwd / equivalent).
2. Git repository root, current branch, and git status --short.
3. Whether there are uncommitted changes, untracked files, or generated/cache files that should be ignored.
4. The last 5 commits on the current branch.
5. Any active task context you can infer from the current files, branch name, TODOs, or recent git state.

Rules for this session:
- Do not assume the cwd shown in Claude.ai is exact; verify it with shell commands.
- Treat this as my local machine. Be careful with destructive commands.
- Do not commit, push, deploy, delete, or run long destructive operations unless I explicitly ask.
- Prefer small, reversible edits.
- If you encounter path differences between Windows and POSIX forms, normalize to the actual local path before proceeding.
- When you finish a step, summarize exactly what changed and how you verified it.

Start by orienting yourself only. Do not modify files yet.`;

export const helpMarkdown = `# Claude Code Remote Control Manager Help

CCRC has two layers:

1. CCRC server/client APIs: this server accepts client connections, starts/resumes local Claude Code sessions on those clients, and records desired remote-control state.
2. Claude.ai remote-control APIs: Claude.ai displays and interacts with sessions after Claude Code remote control is enabled by the client.

## CCRC API

${ccrcEndpoints.map((endpoint) => `- \`${endpoint.method} ${endpoint.path}\` — ${endpoint.description}`).join("\n")}

## Claude.ai remote-control API map from HAR

${claudeAiRemoteEndpoints.map((endpoint) => `- \`${endpoint.method} ${endpoint.path}\` — ${endpoint.description}`).join("\n")}

## Observed remote-session lifecycle

1. CCRC resumes or starts a local Claude Code session on a connected client.
2. The client calls Claude Code SDK remote-control support.
3. Claude.ai lists the session through \`GET /v1/sessions\`.
4. Claude.ai opens the session metadata through \`GET /v1/sessions/:session_id\`.
5. Claude.ai fetches event history through \`GET /v1/sessions/:session_id/events\`.
6. Claude.ai subscribes to live control/messages through the session websocket.
7. Claude.ai posts user events through \`POST /v1/sessions/:session_id/events\`.

## Operator orientation prompt

\`\`\`text
${remoteOperatorPrompt}
\`\`\`

## Notes

- The CCRC bearer token controls connected clients. Treat it as powerful.
- For Windows clients, pass the real local path, for example \`D:\\Projects\\knight-rider\`, not reconstructed metadata such as \`d//Projects/knight/rider\`.
- Claude.ai APIs listed here are observational from a HAR and should be treated as internal/private API behavior.
`;

export function helpJson() {
  return {
    name: "Claude Code Remote Control Manager",
    layers: ["ccrc-server-client", "claude-ai-remote-control"],
    ccrcEndpoints,
    claudeAiRemoteEndpoints,
    observedLifecycle: [
      "CCRC starts or resumes a local Claude Code session on a connected client.",
      "The client enables Claude Code remote control.",
      "Claude.ai lists connected remote-control sessions with /v1/sessions.",
      "Claude.ai opens session metadata and event history.",
      "Claude.ai subscribes to a websocket for live control messages.",
      "Claude.ai posts user events/messages to the session.",
    ],
    operatorPrompt: remoteOperatorPrompt,
    docs: {
      apiMap: "docs/claude-ai-remote-api-map.md",
      operatorPrompt: "docs/remote-session-operator-prompt.md",
    },
  };
}

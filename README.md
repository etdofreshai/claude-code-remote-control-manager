# claude-code-remote-control-manager

Lightweight remote orchestration for Claude Agent SDK sessions across multiple machines.

Two services:
- **server** — browser UI, client registry, request orchestration. Public domain.
- **client** — runs on remote machines, wraps Claude Agent SDK locally.

## Architecture

```
Browser UI → Server → Client Agent → Claude Agent SDK → Claude Code
```

## Quick start

### Server

```
cd server
cp .env.example .env
npm install
npm run build:web    # one-time: install + build the Vite SPA into ./public
npm run dev          # start Fastify on :3000 (serves the built SPA at /)
```

Open http://localhost:3000 and log in with `UI_PASSWORD`.

For active UI development, run the Vite dev server in a second terminal — it
hot-reloads and proxies `/api/*` to Fastify:

```
cd server/web
npm install
npm run dev          # http://localhost:5173
```

Clients register themselves at runtime; there's no manual UI entry. See
**Client** below.

Useful server API endpoints:

- `GET /api/clients` — full client objects with embedded sessions, used by the UI
- `GET /api/clients/list` — compact list of clients with online state and session counts
- `GET /api/clients/:name/sessions` — sessions for a single client plus client metadata
- `POST /api/clients/:name/sessions/:sessionId/message` — send text or content blocks to a running session

### Client

```
cd client
cp .env.example .env       # set SERVER_URL + CLIENT_TOKEN (must match server)
npm install
npm run dev
```

The client must run on a machine where Claude Code and the Claude Agent SDK are
installed. On startup it:

1. POSTs `/api/agent/register` with `{name, hostname, platform, providers, ...}`
   using `Authorization: Bearer ${CLIENT_TOKEN}`. The same token authorizes
   every subsequent agent request.
2. Long-polls `GET /api/agent/poll?name=<name>` (25 s timeout). When the server
   has a queued command (new/bind/list/rename/switch/message/etc.) it responds;
   the client executes it locally and posts the result to `POST /api/agent/ack`.
3. Periodically reports its current session list via `POST /api/agent/sessions`.

The server marks a client "online" if it has been seen in the last 60 s
(`AGENT_OFFLINE_AFTER_MS`). Polling implicitly refreshes the last-seen
timestamp, so an idle client stays online by polling.

Multiple clients can register against one server — each is identified by its
`name` (defaults to `os.hostname()`, overridable via `AGENT_NAME`).

## Env

### Server (`server/.env`)
- `UI_PASSWORD` — UI login password
- `CLIENT_TOKEN` — shared bearer token sent to clients
- `PORT` — default `3000`
- `CLIENTS` — optional JSON array `[{"name":"laptop","baseUrl":"https://..."}]`

### Client (`client/.env`)
- `CLIENT_TOKEN` — shared bearer token (must match server)
- `PORT` — default `4000`
- Native Anthropic auth comes from `~/.claude/.credentials.json` (OAuth). Do not set `ANTHROPIC_API_KEY` — the binary treats it as a long-lived API key and pops an interactive prompt, breaking headless use.
- Gateway tokens (optional, only for gateway-routed providers): `LITELLM_TOKEN`, `SWITCHBOARD_API_KEY`, `ZAI_API_KEY`.

## Deployment

Two Dockerfiles, one per service: `server/Dockerfile` and `client/Dockerfile`.
Deployed via Dokploy as separate applications. The server is given a public domain; the client is reached over HTTP from the server using its `baseUrl`.

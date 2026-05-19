# claude-code-remote-control-manager

Minimal on-demand remote control for Claude Code sessions.

This rewrite intentionally removes the old web UI, schedules, provider matrix, bridge service, Codex support, and transcript database. The goal is small and explicit:

```text
Start server once.
Run a temporary client command on the desktop/laptop when you intentionally want remote control.
Stop the client with Ctrl-C when you are done.
```

## Architecture

```text
Hermes / curl / operator CLI
        ↓ Bearer token API
ccrc-server
        ↓ long-poll command queue
ccrc-client, intentionally running on desktop/laptop
        ↓
local Claude Code via @anthropic-ai/claude-agent-sdk
        ↓
Claude remote control in claude.ai/code / Claude mobile
```

The client only provides:

- its `name`
- the shared token
- the server URL

Everything else is commanded through the server API.

## Safety model

- No broad SSH shell.
- No always-on desktop daemon required.
- No browser UI.
- No arbitrary generic command endpoint.
- Remote control is available only while `ccrc-client` is intentionally running.
- Client shutdown calls `enableRemoteControl(false)` for active sessions and then disconnects.

Important caveat: the HTTP API does not expose a generic shell endpoint, but a remote-controlled Claude Code session can still perform powerful actions through Claude Code tools according to the permission mode and filesystem access of the client process. Treat `CCRCM_TOKEN` / `CCRC_TOKEN` as a powerful secret and expose the server only on trusted networks or behind trusted auth.

## Server

```bash
cd server
cp .env.example .env
npm install
npm run build
npm start
```

Environment:

```bash
CCRCM_TOKEN=change-me
PORT=3000
STATE_FILE=./data/state.json
```

The server persists pinned remote-control sessions in `STATE_FILE`. If the server restarts, connected clients can reconnect. On reconnect, the server queues `resume` commands for pinned sessions so the client can re-enable remote control.

## Client

Run this manually on the machine you want to expose temporarily:

```bash
cd client
cp .env.example .env
npm install
npm run build
node dist/index.js --server http://SERVER:3000 --token change-me --name desktop
```

Or with env vars:

```bash
CCRC_SERVER_URL=http://SERVER:3000 \
CCRC_TOKEN=change-me \
CCRC_NAME=desktop \
node dist/index.js
```

Optional permission mode override:

```bash
CCRC_PERMISSION_MODE=default
CCRC_PERMISSION_MODE=bypassPermissions
```

By default, non-root clients use `bypassPermissions`; root clients fall back to `default` because Claude Code refuses dangerous permission bypass as root.

Stop remote control:

```text
Ctrl-C
```

### Forward local Claude.ai OAuth through the server proxy

The client includes a helper that reads the local Claude Code credential from `~/.claude/.credentials.json`, forwards only the OAuth access token for a single request, and lists live Claude.ai sessions through the server proxy. The server does not store the Claude.ai credential.

```bash
cd client
npm run build
npm run claude-ai:sessions -- --server https://ccrcm.etdofresh.com --token "$CCRC_TOKEN" --limit 25
```

Optional environment:

```bash
CLAUDE_CREDENTIALS_PATH=~/.claude/.credentials.json
CLAUDE_AI_ORGANIZATION_UUID=your-organization-uuid
```

If Claude.ai returns a Cloudflare page or a 403 from the deployed server, the OAuth token alone is not enough from that network; use a browser cookie via `X-Claude-AI-Cookie` or move this call to the desktop client network.

## Docker

There are separate Dockerfiles for the server and client.

### Server image

```bash
docker build -t ccrc-server ./server
docker run --rm -p 3000:3000 \
  -e CCRCM_TOKEN=change-me \
  -e STATE_FILE=/data/state.json \
  -v ccrc-server-data:/data \
  ccrc-server
```

### Client image

The client container controls Claude Code inside that container. To control your actual desktop/laptop, build and run this image on that desktop/laptop and mount the relevant Claude auth/workspace paths.

```bash
docker build -t ccrc-client ./client
docker run --rm \
  -e CCRC_SERVER_URL=http://SERVER:3000 \
  -e CCRC_TOKEN=change-me \
  -e CCRC_NAME=desktop \
  -v "$HOME/.claude:/home/node/.claude" \
  -v "$HOME:/workspace" \
  ccrc-client
```

## Dokploy

`docker-compose.dokploy.yml` is included for a two-service Dokploy deployment:

- `ccrc-server`: persistent API server with `/data/state.json`.
- `ccrc-client`: optional hosted/container test client.

The Dokploy client is useful for proving the full command path works: call the server API, have it command the connected Dokploy client, and verify the client creates/resumes a Claude Code remote-control session. That proves the same server API will work with a desktop/laptop client later.

Important: a client deployed on Dokploy controls Claude Code inside the Dokploy container, not your physical desktop/laptop. To create an actual Claude Code session from that container, the container needs usable Claude auth in `/home/node/.claude` or equivalent Claude Code environment/auth setup, plus a workspace mounted at `/workspace`.

Required compose env:

```bash
CCRCM_TOKEN=change-me
```

Optional compose env:

```bash
CCRC_SERVER_URL=http://ccrc-server:3000
CCRC_NAME=dokploy-client
CCRC_PERMISSION_MODE=bypassPermissions
```

## API

All endpoints except `/healthz` require:

```http
Authorization: Bearer change-me
```

### Health

```bash
curl http://localhost:3000/healthz
```

### List connected clients

```bash
curl -H "Authorization: Bearer change-me" \
  http://localhost:3000/api/clients
```

### List sessions known by a client

This asks the client to enumerate local Claude Code session files and running sessions.

```bash
curl -X POST \
  -H "Authorization: Bearer change-me" \
  http://localhost:3000/api/clients/desktop/sessions/list
```

Cached server view:

```bash
curl -H "Authorization: Bearer change-me" \
  http://localhost:3000/api/clients/desktop/sessions
```

### Create a new remote-controlled Claude Code session

```bash
curl -X POST http://localhost:3000/api/clients/desktop/sessions/new \
  -H "Authorization: Bearer change-me" \
  -H "Content-Type: application/json" \
  -d '{
    "cwd": "/home/et/repos/my-project",
    "name": "my-project",
    "text": "Run the tests and summarize failures."
  }'
```

The returned `sessionId` is persisted by the server as a desired remote-control session.

### Resume a Claude Code session with remote control

```bash
curl -X POST http://localhost:3000/api/clients/desktop/sessions/resume \
  -H "Authorization: Bearer change-me" \
  -H "Content-Type: application/json" \
  -d '{
    "cwd": "/home/et/repos/my-project",
    "sessionId": "00000000-0000-4000-8000-000000000000",
    "name": "my-project"
  }'
```

### Send a message to a running session

```bash
curl -X POST http://localhost:3000/api/clients/desktop/sessions/SESSION_ID/message \
  -H "Authorization: Bearer change-me" \
  -H "Content-Type: application/json" \
  -d '{"text":"Continue and fix the first failure."}'
```

### Stop a session

Stops the local SDK runner, disables Claude remote control, and removes the persisted desired session on the server.

```bash
curl -X POST \
  -H "Authorization: Bearer change-me" \
  http://localhost:3000/api/clients/desktop/sessions/SESSION_ID/stop
```

### Disconnect a client

Ask the client to shut down.

```bash
curl -X POST \
  -H "Authorization: Bearer change-me" \
  http://localhost:3000/api/clients/desktop/disconnect
```

## Current scope

Implemented first:

- Claude Code only.
- Minimal API server.
- Intentional client process.
- Client session listing.
- Create/resume sessions with remote control enabled.
- Send messages.
- Stop sessions.
- Server persistence of pinned remote-controlled sessions.
- Reconnect behavior queues resume commands for pinned sessions.
- Dockerfiles for server/client and a Dokploy-oriented compose file.

Deferred intentionally:

- Codex.
- OpenCode.
- Web UI.
- Schedules/cron.
- Transcript browser/database.
- Provider/model switching.
- Anthropic/OpenAI bridge.
- Generic shell command execution.

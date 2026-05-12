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
npm run dev
```

Open http://localhost:3000, log in with `UI_PASSWORD`.

Register a client by adding it to the in-memory registry from the UI, or by setting `CLIENTS` in env (JSON array).

Useful server API endpoints:

- `GET /api/clients` — full client objects with embedded sessions, used by the UI
- `GET /api/clients/list` — compact list of clients with online state and session counts
- `GET /api/clients/:name/sessions` — sessions for a single client plus client metadata
- `POST /api/clients/:name/sessions/:sessionId/message` — send text or content blocks to a running session

### Client

```
cd client
cp .env.example .env
npm install
npm run dev
```

The client must run on a machine where Claude Code and the Claude Agent SDK are installed. It exposes:

- `GET  /health`
- `POST /session/create`
- `POST /session/connect`
- `POST /session/prompt`
- `GET  /session/list`

All client endpoints require `Authorization: Bearer <CLIENT_TOKEN>`.

## Env

### Server (`server/.env`)
- `UI_PASSWORD` — UI login password
- `CLIENT_TOKEN` — shared bearer token sent to clients
- `PORT` — default `3000`
- `CLIENTS` — optional JSON array `[{"name":"laptop","baseUrl":"https://..."}]`

### Client (`client/.env`)
- `CLIENT_TOKEN` — shared bearer token (must match server)
- `PORT` — default `4000`
- `ANTHROPIC_API_KEY` — used by the Claude Agent SDK

## Deployment

Two Dockerfiles, one per service: `server/Dockerfile` and `client/Dockerfile`.
Deployed via Dokploy as separate applications. The server is given a public domain; the client is reached over HTTP from the server using its `baseUrl`.

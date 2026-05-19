# Remote Claude Code Session Operator Prompt

Use this when opening a Claude Code remote-control session from `claude.ai/code` or Claude mobile/web.

## What the HAR showed

From `workspace/tmp/claude-ai-remote-har/claude.ai.7.har`:

- Claude.ai lists remote sessions with `GET /v1/sessions`.
- A connected remote-control session has:
  - `connection_status: "connected"`
  - `environment_kind: "bridge"`
  - tag such as `remote-control-sdk`, `remote-control-repl`, or `remote-control-auto`
  - `external_metadata.current_branches` when repo/branch metadata is available.
- The `KR Work` session observed in the HAR was:
  - Claude.ai session id: `session_018EzFxwGZi4tFJV2GyTggCm`
  - title: `KR Work`
  - tag: `remote-control-sdk`
  - branch metadata: `Pixel-Dash-Studios/knight-rider: et/iterate-on-gadgets`
  - connected through web socket: `/v1/sessions/ws/session_018EzFxwGZi4tFJV2GyTggCm/subscribe`
- The local Claude Code session id seen inside repo artifacts was `1992d031-68f7-435d-bd02-6b53e0e8a69b`.
- Claude.ai sends user messages through `POST /v1/sessions/:session_id/events`, then receives tool/assistant/control messages via websocket.

## First message to send into a remote session

Paste this as the first user prompt after opening or resuming a remote session:

```text
You are running as a remote-controlled Claude Code session on my machine.

Before changing anything, orient yourself and report:
1. Current working directory (`pwd` / equivalent).
2. Git repository root, current branch, and `git status --short`.
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

Start by orienting yourself only. Do not modify files yet.
```

## Follow-up prompt for continuing known work

Use this when the session has already been oriented and you want it to resume implementation:

```text
Continue the current work in this repository.

First re-check `git status --short` and the current branch. Then inspect the relevant files before editing. Keep changes minimal and focused on the stated task. Run the smallest useful verification command after each change. Do not commit or push unless I explicitly ask.

Task:
<describe the task here>
```

## Prompt for remote session handoff / status report

Use this when you want the remote session to produce a clean handoff:

```text
Produce a concise handoff for this remote Claude Code session.

Include:
- cwd and repo root
- branch
- git status summary
- what task you were working on
- files changed
- commands/tests run and results
- blockers or questions
- exact next recommended step

Do not modify files.
```

## Operator checklist outside Claude.ai

Before asking a remote session to work:

1. Confirm the local client is connected to the CCRC server.
2. Confirm the intended session is connected in Claude.ai, not merely listed as historical.
3. If resuming by local session id, pass the real machine path, e.g. Windows `D:\Projects\knight-rider`, not a reconstructed path like `d//Projects/knight/rider`.
4. Open the session in Claude.ai and send the orientation prompt.
5. Only after it reports cwd/branch/status, send the actual work prompt.

## Notes for this project

- The CCRC server can bind/resume a local session by `client + sessionId + cwd`.
- The server's reported local session metadata may have path normalization artifacts. For Windows, prefer the real local path from the user.
- A successful resume ack means the client accepted the resume/remote-control command; Claude.ai may still show older cached metadata until the session sends new events.

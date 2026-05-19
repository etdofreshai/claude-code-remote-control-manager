import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApp } from "../src/app.ts";
import { RemoteControlState } from "../src/state.ts";

const token = "test-token";
const auth = { authorization: `Bearer ${token}` };

function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), "ccrc-api-"));
  const state = new RemoteControlState({ stateFile: path.join(dir, "state.json"), pollTimeoutMs: 10, ackTimeoutMs: 100 });
  const app = createApp({ state, token });
  return { app, state };
}

test("agent connect and operator list clients", async () => {
  const { app } = fixture();
  await app.ready();

  const connect = await app.inject({ method: "POST", url: "/api/agent/connect", headers: auth, payload: { name: "desktop" } });
  assert.equal(connect.statusCode, 200);

  const list = await app.inject({ method: "GET", url: "/api/clients", headers: auth });
  assert.equal(list.statusCode, 200);
  assert.equal(list.json()[0].name, "desktop");
  assert.equal(list.json()[0].online, true);
  assert.deepEqual(list.json()[0].knownSessions, []);
  assert.deepEqual(list.json()[0].pinnedSessions, []);
  assert.equal("reportedSessions" in list.json()[0], false);
  assert.equal("desiredSessions" in list.json()[0], false);

  const sessions = await app.inject({ method: "GET", url: "/api/clients/desktop/sessions", headers: auth });
  assert.equal(sessions.statusCode, 200);
  assert.deepEqual(sessions.json(), { knownSessions: [], pinnedSessions: [] });

  await app.close();
});

test("operator start enqueues command and resolves from agent ack", async () => {
  const { app } = fixture();
  await app.ready();
  await app.inject({ method: "POST", url: "/api/agent/connect", headers: auth, payload: { name: "desktop" } });

  const startPromise = app.inject({
    method: "POST",
    url: "/api/clients/desktop/sessions/new",
    headers: auth,
    payload: { cwd: "/repo", name: "repo", text: "hello" },
  });

  const poll = await app.inject({ method: "GET", url: "/api/agent/poll?name=desktop", headers: auth });
  assert.equal(poll.statusCode, 200);
  const cmd = poll.json();
  assert.equal(cmd.type, "start");
  assert.equal(cmd.payload.remoteControl, true);

  const ack = await app.inject({ method: "POST", url: "/api/agent/ack", headers: auth, payload: { id: cmd.id, ok: true, result: { sessionId: "44444444-4444-4444-8444-444444444444" } } });
  assert.equal(ack.statusCode, 200);

  const start = await startPromise;
  assert.equal(start.statusCode, 200);
  assert.equal(start.json().sessionId, "44444444-4444-4444-8444-444444444444");

  await app.close();
});

test("unauthorized requests are rejected", async () => {
  const { app } = fixture();
  await app.ready();
  const res = await app.inject({ method: "GET", url: "/api/clients" });
  assert.equal(res.statusCode, 401);
  await app.close();
});

test("help endpoints expose docs", async () => {
  const { app } = fixture();
  await app.ready();

  const publicHelp = await app.inject({ method: "GET", url: "/help" });
  assert.equal(publicHelp.statusCode, 200);
  assert.match(publicHelp.body, /Claude Code Remote Control Manager Help/);
  assert.match(publicHelp.headers["content-type"] ?? "", /text\/markdown/);

  const apiHelpUnauthed = await app.inject({ method: "GET", url: "/api/help" });
  assert.equal(apiHelpUnauthed.statusCode, 401);

  const apiHelp = await app.inject({ method: "GET", url: "/api/help", headers: auth });
  assert.equal(apiHelp.statusCode, 200);
  assert.equal(apiHelp.json().name, "Claude Code Remote Control Manager");
  assert.ok(apiHelp.json().ccrcEndpoints.some((endpoint: { path: string }) => endpoint.path === "/api/clients"));
  assert.ok(apiHelp.json().ccrcEndpoints.some((endpoint: { path: string }) => endpoint.path === "/api/claude-ai/sessions"));
  assert.ok(apiHelp.json().claudeAiRemoteEndpoints.some((endpoint: { path: string }) => endpoint.path.includes("/v1/sessions")));

  await app.close();
});

test("claude.ai proxy requires forwarded Claude.ai auth", async () => {
  const { app } = fixture();
  await app.ready();

  const missing = await app.inject({ method: "GET", url: "/api/claude-ai/sessions", headers: auth });
  assert.equal(missing.statusCode, 400);
  assert.match(missing.body, /missing forwarded Claude\.ai auth/);

  await app.close();
});

test("claude.ai proxy can page all events and expose message-only history", async () => {
  const { app } = fixture();
  await app.ready();

  const originalFetch = globalThis.fetch;
  const seenUrls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    seenUrls.push(url);
    const parsed = new URL(url);
    const afterId = parsed.searchParams.get("after_id");
    const body = afterId
      ? { data: [{ uuid: "event-2", type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "hello back" }] } }], first_id: "event-2", last_id: "event-2", has_more: false }
      : { data: [{ uuid: "event-1", type: "user", message: { role: "user", content: "hello" } }, { uuid: "tool-1", type: "tool_use", message: null }], first_id: "event-1", last_id: "event-1", has_more: true };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  try {
    const headers = {
      ...auth,
      "x-claude-ai-authorization": "Bearer claude-token",
      "x-claude-ai-organization-uuid": "org",
      "x-claude-ai-version": "2023-06-01",
      "x-claude-ai-beta": "ccr-byoc-2025-07-29",
      "x-claude-ai-client-platform": "web_claude_ai",
      "x-claude-ai-client-feature": "ccr",
      "x-claude-ai-client-version": "1.0.0",
    };

    const all = await app.inject({ method: "GET", url: "/api/claude-ai/sessions/session_abc123/events/all?limit=1000&max_pages=5", headers });
    assert.equal(all.statusCode, 200);
    assert.equal(all.json().data.length, 3);
    assert.equal(all.json().first_id, "event-1");
    assert.equal(all.json().last_id, "event-2");
    assert.equal(all.json().has_more, false);
    assert.equal(all.json().pages, 2);
    assert.ok(seenUrls[0].includes("/v1/sessions/session_abc123/events?limit=1000"));
    assert.ok(seenUrls[1].includes("after_id=event-1"));

    seenUrls.length = 0;
    const messages = await app.inject({ method: "GET", url: "/api/claude-ai/sessions/session_abc123/messages?limit=1000", headers });
    assert.equal(messages.statusCode, 200);
    assert.deepEqual(messages.json().data.map((event: { uuid: string }) => event.uuid), ["event-1", "event-2"]);
  } finally {
    globalThis.fetch = originalFetch;
    await app.close();
  }
});

test("operator can delete offline clients but not online clients without force", async () => {
  const { app, state } = fixture();
  await app.ready();

  await app.inject({ method: "POST", url: "/api/agent/connect", headers: auth, payload: { name: "offline-client", knownSessions: [{ sessionId: "s1" }] } });
  state.pinSession("offline-client", {
    sessionId: "77777777-7777-4777-8777-777777777777",
    cwd: "/repo",
    remoteControl: true,
  });
  state.disconnectClient("offline-client");

  const deleted = await app.inject({ method: "DELETE", url: "/api/clients/offline-client", headers: auth });
  assert.equal(deleted.statusCode, 200);
  assert.deepEqual(deleted.json(), { deleted: true, client: "offline-client", wasOnline: false, forced: false });

  const missing = await app.inject({ method: "GET", url: "/api/clients/offline-client", headers: auth });
  assert.equal(missing.statusCode, 404);

  await app.inject({ method: "POST", url: "/api/agent/connect", headers: auth, payload: { name: "online-client" } });
  const blocked = await app.inject({ method: "DELETE", url: "/api/clients/online-client", headers: auth });
  assert.equal(blocked.statusCode, 409);
  assert.equal(blocked.json().online, true);

  const forced = await app.inject({ method: "DELETE", url: "/api/clients/online-client?force=true", headers: auth });
  assert.equal(forced.statusCode, 200);
  assert.deepEqual(forced.json(), { deleted: true, client: "online-client", wasOnline: true, forced: true });

  await app.close();
});

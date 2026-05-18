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

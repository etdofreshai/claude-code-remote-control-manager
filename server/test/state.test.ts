import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { RemoteControlState } from "../src/state.ts";

test("connect registers a client and queues persisted pinned sessions for restart", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ccrc-state-"));
  const stateFile = path.join(dir, "state.json");
  const state = new RemoteControlState({ stateFile, pollTimeoutMs: 5, ackTimeoutMs: 50 });

  state.pinSession("desktop", {
    sessionId: "11111111-1111-4111-8111-111111111111",
    cwd: "/home/et/repos/app",
    name: "app",
    remoteControl: true,
  });

  const connected = state.connectClient({ name: "desktop" });
  assert.equal(connected.name, "desktop");
  assert.equal(state.listClients()[0].online, true);

  const cmd = await state.takeNextCommand("desktop");
  assert.equal(cmd?.type, "resume");
  assert.deepEqual(cmd?.payload, {
    sessionId: "11111111-1111-4111-8111-111111111111",
    cwd: "/home/et/repos/app",
    name: "app",
    remoteControl: true,
  });
});

test("fire-and-forget resume ack persists remote-control metadata onto the pinned session", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ccrc-state-"));
  const stateFile = path.join(dir, "state.json");
  const state = new RemoteControlState({ stateFile, pollTimeoutMs: 5, ackTimeoutMs: 1000 });

  const sessionId = "44444444-4444-4444-8444-444444444444";
  state.pinSession("desktop", {
    sessionId,
    cwd: "/home/et/repos/app",
    name: "app",
    remoteControl: true,
  });

  // Reconnect queues a fire-and-forget resume command for the pinned session.
  state.connectClient({ name: "desktop" });
  const cmd = await state.takeNextCommand("desktop");
  assert.equal(cmd?.type, "resume");
  assert.equal(cmd?.payload.sessionId, sessionId);

  // Client ACKs the auto-resume command with metadata from enableRemoteControl(true).
  state.ackCommand(cmd!.id, {
    ok: true,
    result: {
      sessionId,
      cwd: "/home/et/repos/app",
      name: "app",
      remoteControl: true,
      claudeAiSessionId: "session_abc",
      controlSessionId: "cse_abc",
      sessionUrl: "https://claude.ai/code/cse_abc",
      remoteControlInfo: { raw: "info" },
      bridgePointer: { pointer: "xyz" },
    },
  });

  const pinned = state.getClient("desktop")?.pinnedSessions[0];
  assert.equal(pinned?.sessionId, sessionId);
  assert.equal(pinned?.claudeAiSessionId, "session_abc");
  assert.equal(pinned?.controlSessionId, "cse_abc");
  assert.equal(pinned?.sessionUrl, "https://claude.ai/code/cse_abc");
  assert.deepEqual(pinned?.remoteControlInfo, { raw: "info" });
  assert.deepEqual(pinned?.bridgePointer, { pointer: "xyz" });

  const saved = JSON.parse(readFileSync(stateFile, "utf8"));
  assert.equal(saved.clients.desktop.pinnedSessions[0].claudeAiSessionId, "session_abc");
  assert.equal(saved.clients.desktop.pinnedSessions[0].controlSessionId, "cse_abc");
  assert.equal(saved.clients.desktop.pinnedSessions[0].sessionUrl, "https://claude.ai/code/cse_abc");
});

test("failed fire-and-forget resume ack leaves the pinned session metadata untouched", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ccrc-state-"));
  const stateFile = path.join(dir, "state.json");
  const state = new RemoteControlState({ stateFile, pollTimeoutMs: 5, ackTimeoutMs: 1000 });

  const sessionId = "77777777-7777-4777-8777-777777777777";
  state.pinSession("desktop", { sessionId, cwd: "/repo", name: "repo", remoteControl: true });
  state.connectClient({ name: "desktop" });
  const cmd = await state.takeNextCommand("desktop");
  assert.equal(cmd?.type, "resume");

  state.ackCommand(cmd!.id, { ok: false, error: "resume failed" });

  const pinned = state.getClient("desktop")?.pinnedSessions[0];
  assert.equal(pinned?.claudeAiSessionId, undefined);
  assert.equal(pinned?.controlSessionId, undefined);
});

test("new session command persists returned session id as pinned remote-control state", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ccrc-state-"));
  const stateFile = path.join(dir, "state.json");
  const state = new RemoteControlState({ stateFile, pollTimeoutMs: 5, ackTimeoutMs: 100 });
  state.connectClient({ name: "laptop" });

  const pending = state.enqueueStart("laptop", { cwd: "/repo", name: "work", text: "hello" });
  const cmd = await state.takeNextCommand("laptop");
  assert.equal(cmd?.type, "start");

  state.ackCommand(cmd!.id, { ok: true, result: { sessionId: "22222222-2222-4222-8222-222222222222" } });
  const result = await pending;
  assert.deepEqual(result, { sessionId: "22222222-2222-4222-8222-222222222222" });

  const saved = JSON.parse(readFileSync(stateFile, "utf8"));
  assert.equal(saved.clients.laptop.pinnedSessions[0].sessionId, "22222222-2222-4222-8222-222222222222");
  assert.equal(saved.clients.laptop.pinnedSessions[0].remoteControl, true);
});

test("disconnect marks client offline but keeps pinned sessions for later reconnect", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ccrc-state-"));
  const state = new RemoteControlState({ stateFile: path.join(dir, "state.json") });
  state.connectClient({ name: "desktop" });
  state.pinSession("desktop", {
    sessionId: "33333333-3333-4333-8333-333333333333",
    cwd: "/repo",
    remoteControl: true,
  });

  state.disconnectClient("desktop");

  const client = state.listClients()[0];
  assert.equal(client.online, false);
  assert.equal(client.pinnedSessions.length, 1);
});

test("resume for an offline known client persists pinned session without waiting for ack", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ccrc-state-"));
  const state = new RemoteControlState({ stateFile: path.join(dir, "state.json"), pollTimeoutMs: 5, ackTimeoutMs: 20 });
  state.connectClient({ name: "desktop" });
  state.disconnectClient("desktop");

  const result = await state.enqueueResume("desktop", {
    sessionId: "55555555-5555-4555-8555-555555555555",
    cwd: "/repo",
    name: "repo",
  });

  assert.deepEqual(result, { queuedForReconnect: true, sessionId: "55555555-5555-4555-8555-555555555555" });
  const reconnect = state.connectClient({ name: "desktop" });
  assert.equal(reconnect.pinnedSessions.length, 1);
  const cmd = await state.takeNextCommand("desktop");
  assert.equal(cmd?.type, "resume");
  assert.equal(cmd?.payload.sessionId, "55555555-5555-4555-8555-555555555555");
});

test("deleteClient removes offline client state and persists removal", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ccrc-state-"));
  const stateFile = path.join(dir, "state.json");
  const state = new RemoteControlState({ stateFile });
  state.connectClient({ name: "old-client", knownSessions: [{ sessionId: "a" }] });
  state.pinSession("old-client", {
    sessionId: "66666666-6666-4666-8666-666666666666",
    cwd: "/repo",
    remoteControl: true,
  });
  state.disconnectClient("old-client");

  assert.deepEqual(state.deleteClient("old-client"), { deleted: true, online: false });
  assert.equal(state.getClient("old-client"), undefined);
  const saved = JSON.parse(readFileSync(stateFile, "utf8"));
  assert.equal(saved.clients["old-client"], undefined);
});

test("deleteClient refuses online clients unless forced", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ccrc-state-"));
  const state = new RemoteControlState({ stateFile: path.join(dir, "state.json") });
  state.connectClient({ name: "active-client" });

  assert.deepEqual(state.deleteClient("active-client"), { deleted: false, online: true });
  assert.ok(state.getClient("active-client"));
  assert.deepEqual(state.deleteClient("active-client", { force: true }), { deleted: true, online: true });
  assert.equal(state.getClient("active-client"), undefined);
});

test("loads legacy reportedSessions/desiredSessions state into knownSessions/pinnedSessions", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ccrc-state-"));
  const stateFile = path.join(dir, "state.json");
  writeFileSync(
    stateFile,
    JSON.stringify({
      clients: {
        legacy: {
          connectedAt: "2026-01-01T00:00:00.000Z",
          lastSeenAt: "2026-01-01T00:00:00.000Z",
          reportedSessions: [{ sessionId: "legacy-known" }],
          desiredSessions: [{ sessionId: "legacy-pinned", cwd: "/repo", remoteControl: true }],
        },
      },
    }),
  );

  const state = new RemoteControlState({ stateFile });
  const client = state.getClient("legacy");
  assert.deepEqual(client?.knownSessions, [{ sessionId: "legacy-known" }]);
  assert.deepEqual(client?.pinnedSessions, [{ sessionId: "legacy-pinned", cwd: "/repo", remoteControl: true }]);
  assert.equal((client as unknown as { reportedSessions?: unknown[] })?.reportedSessions, undefined);
  assert.equal((client as unknown as { desiredSessions?: unknown[] })?.desiredSessions, undefined);
});

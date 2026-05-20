import test from "node:test";
import assert from "node:assert/strict";
import { ClientRuntime } from "../src/runtime.ts";
import type { ClaudeController, RemoteCommand, ServerApi } from "../src/types.ts";

class FakeClaude implements ClaudeController {
  calls: Array<{ name: string; args: unknown }> = [];
  async listSessions() {
    this.calls.push({ name: "listSessions", args: {} });
    return [{ sessionId: "existing", cwd: "/repo" }];
  }
  async startSession(input: { cwd: string; name?: string; text?: string }) {
    this.calls.push({ name: "startSession", args: input });
    return { sessionId: "new-session", cwd: input.cwd, name: input.name };
  }
  async resumeSession(input: { sessionId: string; cwd: string; name?: string }) {
    this.calls.push({ name: "resumeSession", args: input });
    return { sessionId: input.sessionId, cwd: input.cwd, name: input.name };
  }
  async sendMessage(input: { sessionId: string; text: string }) {
    this.calls.push({ name: "sendMessage", args: input });
    return { sent: true };
  }
  async interruptSession(input: { sessionId: string; text?: string; name?: string }) {
    this.calls.push({ name: "interruptSession", args: input });
    return { sessionId: input.sessionId, interrupted: true, steered: Boolean(input.text) };
  }
  async stopSession(sessionId: string) {
    this.calls.push({ name: "stopSession", args: sessionId });
    return { stopped: true };
  }
  async shutdown() {
    this.calls.push({ name: "shutdown", args: {} });
  }
}

class FakeServer implements ServerApi {
  acks: unknown[] = [];
  disconnects: string[] = [];
  reports: unknown[] = [];
  constructor(public commands: Array<RemoteCommand | null>, private readonly connectResult: unknown = { ok: true }) {}
  async connect() { return this.connectResult; }
  async poll() { return this.commands.shift() ?? null; }
  async ack(id: string, body: { ok: boolean; result?: unknown; error?: string }) { this.acks.push({ id, ...body }); }
  async disconnect(name: string) { this.disconnects.push(name); }
  async reportSessions(name: string, sessions: unknown[]) { this.reports.push({ name, sessions }); }
}

test("runtime starts, resumes, lists, sends, and stops sessions from commands", async () => {
  const claude = new FakeClaude();
  const server = new FakeServer([
    { id: "1", type: "start", payload: { cwd: "/repo", name: "repo", text: "hello" } },
    { id: "2", type: "resume", payload: { cwd: "/repo", sessionId: "old", name: "old" } },
    { id: "3", type: "list-sessions", payload: {} },
    { id: "4", type: "message", payload: { sessionId: "old", text: "continue" } },
    { id: "5", type: "interrupt", payload: { sessionId: "old", text: "wait, inspect first", name: "steered" } },
    { id: "6", type: "stop", payload: { sessionId: "old" } },
    { id: "7", type: "disconnect", payload: {} },
  ], { pinnedSessions: [{ sessionId: "pinned", cwd: "/repo", name: "Pinned Work", remoteControl: true }] });
  const logs: string[] = [];
  const runtime = new ClientRuntime({ name: "desktop", server, claude, log: (message) => logs.push(message) });

  await runtime.runUntilDisconnected();

  assert.deepEqual(claude.calls.map((c) => c.name).filter((name) => name !== "listSessions"), [
    "startSession",
    "resumeSession",
    "sendMessage",
    "interruptSession",
    "stopSession",
    "shutdown",
  ]);
  assert.equal(server.acks.length, 7);
  assert.deepEqual(server.disconnects, ["desktop"]);
  assert.ok(logs.some((line) => line.includes("connected client=desktop")));
  assert.ok(logs.some((line) => line.includes("pinned sessions at startup: 1")));
  assert.ok(logs.some((line) => line.includes("pinned sessionId=pinned")));
  assert.ok(logs.some((line) => line.includes("created sessionId=new-session")));
  assert.ok(logs.some((line) => line.includes("resumed sessionId=old")));
  assert.ok(logs.some((line) => line.includes("destroyed sessionId=old")));
});

test("runtime acknowledges command errors without crashing", async () => {
  const claude = new FakeClaude();
  const server = new FakeServer([
    { id: "bad", type: "message", payload: { sessionId: "missing" } },
    { id: "bye", type: "disconnect", payload: {} },
  ]);
  const runtime = new ClientRuntime({ name: "desktop", server, claude, log: () => undefined });

  await runtime.runUntilDisconnected();

  assert.equal((server.acks[0] as any).ok, false);
  assert.match((server.acks[0] as any).error, /text required/);
});

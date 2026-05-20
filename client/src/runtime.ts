import type { ClaudeController, RemoteCommand, ServerApi } from "./types.js";

export interface ClientRuntimeOptions {
  name: string;
  server: ServerApi;
  claude: ClaudeController;
  idleDelayMs?: number;
  log?: (message: string) => void;
}

export class ClientRuntime {
  private stopped = false;
  private readonly name: string;
  private readonly server: ServerApi;
  private readonly claude: ClaudeController;
  private readonly idleDelayMs: number;
  private readonly log: (message: string) => void;

  constructor(options: ClientRuntimeOptions) {
    this.name = options.name;
    this.server = options.server;
    this.claude = options.claude;
    this.idleDelayMs = options.idleDelayMs ?? 1000;
    this.log = options.log ?? ((message) => console.log(message));
  }

  async runUntilDisconnected(): Promise<void> {
    const connectResult = await this.server.connect();
    this.logStartup(connectResult);
    await this.reportSessionsBestEffort();

    while (!this.stopped) {
      const command = await this.server.poll();
      if (!command) {
        await sleep(this.idleDelayMs);
        continue;
      }
      await this.handleCommand(command);
    }
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    await this.claude.shutdown();
    await this.server.disconnect(this.name);
  }

  private async handleCommand(command: RemoteCommand): Promise<void> {
    try {
      const result = await this.execute(command);
      this.logCommandSuccess(command, result);
      await this.server.ack(command.id, { ok: true, result });
      if (command.type !== "disconnect") await this.reportSessionsBestEffort();
    } catch (err) {
      this.log(`[remote-control] command ${command.type} failed: ${errorMessage(err)}`);
      await this.server.ack(command.id, { ok: false, error: errorMessage(err) });
    }
  }

  private async execute(command: RemoteCommand): Promise<unknown> {
    const payload = command.payload;
    if (command.type === "list-sessions") return this.claude.listSessions();
    if (command.type === "start") {
      const cwd = requiredString(payload.cwd, "cwd");
      const name = optionalString(payload.name);
      const text = optionalString(payload.text);
      return this.claude.startSession({ cwd, name, text });
    }
    if (command.type === "resume") {
      const cwd = requiredString(payload.cwd, "cwd");
      const sessionId = requiredString(payload.sessionId, "sessionId");
      const name = optionalString(payload.name);
      return this.claude.resumeSession({ cwd, sessionId, name });
    }
    if (command.type === "message") {
      const sessionId = requiredString(payload.sessionId, "sessionId");
      const text = requiredString(payload.text, "text");
      return this.claude.sendMessage({ sessionId, text });
    }
    if (command.type === "stop") {
      const sessionId = requiredString(payload.sessionId, "sessionId");
      return this.claude.stopSession(sessionId);
    }
    if (command.type === "disconnect") {
      await this.stop();
      return { disconnected: true };
    }
    throw new Error(`unknown command type: ${(command as { type?: string }).type}`);
  }

  private async reportSessionsBestEffort(): Promise<void> {
    try {
      await this.server.reportSessions(this.name, await this.claude.listSessions());
    } catch (err) {
      console.error("reportSessions failed", err);
    }
  }

  private logStartup(connectResult: unknown): void {
    const pinned = pinnedSessionsFromConnectResult(connectResult);
    this.log(`[remote-control] connected client=${this.name}`);
    if (!pinned.length) {
      this.log("[remote-control] pinned sessions at startup: 0");
      return;
    }
    this.log(`[remote-control] pinned sessions at startup: ${pinned.length}`);
    for (const session of pinned) {
      this.log(`[remote-control]   pinned ${describeSession(session)}`);
    }
  }

  private logCommandSuccess(command: RemoteCommand, result: unknown): void {
    if (command.type === "start") {
      this.log(`[remote-control] created ${describeSession(result, command.payload)}`);
      return;
    }
    if (command.type === "resume") {
      this.log(`[remote-control] resumed ${describeSession(result, command.payload)}`);
      return;
    }
    if (command.type === "stop") {
      const sessionId = stringField(command.payload, "sessionId") ?? stringField(result, "sessionId") ?? "unknown";
      const stopped = typeof result === "object" && result !== null && (result as { stopped?: unknown }).stopped === false ? "not-running" : "stopped";
      this.log(`[remote-control] destroyed sessionId=${sessionId} status=${stopped}`);
      return;
    }
    if (command.type === "disconnect") {
      this.log("[remote-control] disconnected; remote control disabled for active sessions");
    }
  }
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} required`);
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function pinnedSessionsFromConnectResult(result: unknown): unknown[] {
  if (!result || typeof result !== "object") return [];
  const maybe = (result as { pinnedSessions?: unknown; desiredSessions?: unknown }).pinnedSessions ?? (result as { desiredSessions?: unknown }).desiredSessions;
  return Array.isArray(maybe) ? maybe : [];
}

function describeSession(primary: unknown, fallback?: unknown): string {
  const sessionId = stringField(primary, "sessionId") ?? stringField(fallback, "sessionId") ?? "unknown";
  const cwd = stringField(primary, "cwd") ?? stringField(fallback, "cwd");
  const name = stringField(primary, "name") ?? stringField(primary, "title") ?? stringField(fallback, "name");
  const remoteControl = booleanField(primary, "remoteControl") ?? booleanField(fallback, "remoteControl");
  const claudeAiSessionId = stringField(primary, "claudeAiSessionId") ?? stringField(fallback, "claudeAiSessionId");
  const controlSessionId = stringField(primary, "controlSessionId") ?? stringField(fallback, "controlSessionId");
  const sessionUrl = stringField(primary, "sessionUrl") ?? stringField(fallback, "sessionUrl");
  const parts = [`sessionId=${sessionId}`];
  if (name) parts.push(`name=${JSON.stringify(name)}`);
  if (cwd) parts.push(`cwd=${JSON.stringify(cwd)}`);
  if (remoteControl !== undefined) parts.push(`remoteControl=${remoteControl}`);
  if (claudeAiSessionId) parts.push(`claudeAiSessionId=${claudeAiSessionId}`);
  if (controlSessionId) parts.push(`controlSessionId=${controlSessionId}`);
  if (sessionUrl) parts.push(`sessionUrl=${JSON.stringify(sessionUrl)}`);
  return parts.join(" ");
}

function stringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const maybe = (value as Record<string, unknown>)[key];
  return typeof maybe === "string" && maybe.trim() ? maybe : undefined;
}

function booleanField(value: unknown, key: string): boolean | undefined {
  if (!value || typeof value !== "object") return undefined;
  const maybe = (value as Record<string, unknown>)[key];
  return typeof maybe === "boolean" ? maybe : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

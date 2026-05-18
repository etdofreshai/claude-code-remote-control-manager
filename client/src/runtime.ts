import type { ClaudeController, RemoteCommand, ServerApi } from "./types.js";

export interface ClientRuntimeOptions {
  name: string;
  server: ServerApi;
  claude: ClaudeController;
  idleDelayMs?: number;
}

export class ClientRuntime {
  private stopped = false;
  private readonly name: string;
  private readonly server: ServerApi;
  private readonly claude: ClaudeController;
  private readonly idleDelayMs: number;

  constructor(options: ClientRuntimeOptions) {
    this.name = options.name;
    this.server = options.server;
    this.claude = options.claude;
    this.idleDelayMs = options.idleDelayMs ?? 1000;
  }

  async runUntilDisconnected(): Promise<void> {
    await this.server.connect();
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
      await this.server.ack(command.id, { ok: true, result });
      if (command.type !== "disconnect") await this.reportSessionsBestEffort();
    } catch (err) {
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

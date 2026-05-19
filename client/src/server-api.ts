import type { RemoteCommand, ServerApi } from "./types.js";

export interface HttpServerApiOptions {
  serverUrl: string;
  token: string;
  name: string;
}

export class HttpServerApi implements ServerApi {
  private readonly serverUrl: string;
  private readonly token: string;
  private readonly name: string;

  constructor(options: HttpServerApiOptions) {
    this.serverUrl = options.serverUrl.replace(/\/+$/, "");
    this.token = options.token;
    this.name = options.name;
    if (!this.serverUrl) throw new Error("serverUrl required");
    if (!this.token) throw new Error("token required");
    if (!this.name) throw new Error("name required");
  }

  async connect(): Promise<unknown> {
    return this.post("/api/agent/connect", { name: this.name });
  }

  async poll(): Promise<RemoteCommand | null> {
    const res = await fetch(`${this.serverUrl}/api/agent/poll?name=${encodeURIComponent(this.name)}`, {
      headers: this.headers(),
    });
    if (res.status === 204) return null;
    if (!res.ok) throw new Error(`poll failed ${res.status}: ${await res.text()}`);
    return (await res.json()) as RemoteCommand;
  }

  async ack(id: string, body: { ok: boolean; result?: unknown; error?: string }): Promise<void> {
    await this.post("/api/agent/ack", { id, ...body });
  }

  async disconnect(name: string): Promise<void> {
    await this.post("/api/agent/disconnect", { name });
  }

  async reportSessions(name: string, sessions: unknown[]): Promise<void> {
    await this.post("/api/agent/sessions", { name, sessions });
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    const res = await fetch(`${this.serverUrl}${path}`, {
      method: "POST",
      headers: { ...this.headers(), "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${path} failed ${res.status}: ${await res.text()}`);
    return res.headers.get("content-type")?.includes("json") ? res.json() : null;
  }

  private headers(): Record<string, string> {
    return { authorization: `Bearer ${this.token}` };
  }
}

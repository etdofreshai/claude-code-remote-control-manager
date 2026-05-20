import WebSocket from "ws";
import type { RemoteCommand, ServerApi } from "./types.js";

export interface WebSocketServerApiOptions {
  serverUrl: string;
  token: string;
  name: string;
  reconnectDelayMs?: number;
}

type AckBody = { ok: boolean; result?: unknown; error?: string };

interface PendingPoll {
  resolve: (command: RemoteCommand | null) => void;
  reject: (error: unknown) => void;
}

export class WebSocketServerApi implements ServerApi {
  private readonly serverUrl: string;
  private readonly token: string;
  private readonly name: string;
  private readonly reconnectDelayMs: number;
  private socket?: WebSocket;
  private connectedResult?: unknown;
  private commandQueue: RemoteCommand[] = [];
  private pendingPolls: PendingPoll[] = [];
  private intentionallyClosed = false;
  private connectPromise?: Promise<unknown>;

  constructor(options: WebSocketServerApiOptions) {
    this.serverUrl = options.serverUrl.replace(/\/+$/, "");
    this.token = options.token;
    this.name = options.name;
    this.reconnectDelayMs = options.reconnectDelayMs ?? 1000;
    if (!this.serverUrl) throw new Error("serverUrl required");
    if (!this.token) throw new Error("token required");
    if (!this.name) throw new Error("name required");
  }

  async connect(): Promise<unknown> {
    if (this.connectPromise) return this.connectPromise;
    this.intentionallyClosed = false;
    this.connectPromise = this.openSocket();
    return this.connectPromise;
  }

  async poll(): Promise<RemoteCommand | null> {
    if (this.commandQueue.length) return this.commandQueue.shift()!;
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) await this.connect();
    return new Promise((resolve, reject) => this.pendingPolls.push({ resolve, reject }));
  }

  async ack(id: string, body: AckBody): Promise<void> {
    this.send({ type: "ack", id, ...body });
  }

  async disconnect(name: string): Promise<void> {
    this.intentionallyClosed = true;
    if (this.socket?.readyState === WebSocket.OPEN) this.send({ type: "disconnect", name });
    this.socket?.close(1000, "client disconnect");
    this.resolvePendingPolls(null);
  }

  async reportSessions(_name: string, sessions: unknown[]): Promise<void> {
    this.send({ type: "sessions", sessions });
  }

  private openSocket(): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const url = this.wsUrl();
      const socket = new WebSocket(url, { headers: { authorization: `Bearer ${this.token}` } });
      this.socket = socket;
      let settled = false;
      const fail = (err: unknown) => {
        if (!settled) {
          settled = true;
          this.connectPromise = undefined;
          reject(err);
        } else {
          this.rejectPendingPolls(err);
        }
      };
      socket.on("message", (raw) => {
        try {
          const message = JSON.parse(raw.toString()) as { type?: string; result?: unknown; command?: RemoteCommand; error?: string };
          if (message.type === "connected") {
            this.connectedResult = message.result ?? {};
            if (!settled) {
              settled = true;
              resolve(this.connectedResult);
            }
            return;
          }
          if (message.type === "command" && message.command) {
            this.enqueueCommand(message.command);
            return;
          }
          if (message.type === "error") {
            console.error(`[remote-control] websocket server error: ${message.error ?? "unknown"}`);
          }
        } catch (err) {
          fail(err);
        }
      });
      socket.on("error", fail);
      socket.on("close", () => {
        this.socket = undefined;
        this.connectPromise = undefined;
        if (!settled && !this.intentionallyClosed) fail(new Error("websocket closed before connect"));
        if (!this.intentionallyClosed) this.scheduleReconnect();
      });
    });
  }

  private scheduleReconnect(): void {
    setTimeout(() => {
      if (this.intentionallyClosed || this.socket) return;
      void this.connect().catch((err) => {
        console.error(`[remote-control] websocket reconnect failed: ${err instanceof Error ? err.message : String(err)}`);
        this.scheduleReconnect();
      });
    }, this.reconnectDelayMs).unref?.();
  }

  private enqueueCommand(command: RemoteCommand): void {
    const pending = this.pendingPolls.shift();
    if (pending) pending.resolve(command);
    else this.commandQueue.push(command);
  }

  private resolvePendingPolls(command: RemoteCommand | null): void {
    while (this.pendingPolls.length) this.pendingPolls.shift()!.resolve(command);
  }

  private rejectPendingPolls(err: unknown): void {
    while (this.pendingPolls.length) this.pendingPolls.shift()!.reject(err);
  }

  private send(message: unknown): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) throw new Error("websocket is not connected");
    this.socket.send(JSON.stringify(message));
  }

  private wsUrl(): string {
    const base = new URL(this.serverUrl);
    base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
    base.pathname = `${base.pathname.replace(/\/$/, "")}/api/agent/ws`;
    base.search = `?name=${encodeURIComponent(this.name)}`;
    return base.toString();
  }
}

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type CommandType = "list-sessions" | "start" | "resume" | "message" | "stop" | "disconnect";

export interface RemoteCommand {
  id: string;
  type: CommandType;
  payload: Record<string, unknown>;
}

export interface PinnedSession {
  sessionId: string;
  cwd: string;
  name?: string;
  remoteControl: boolean;
  lastStartedAt?: string;
  claudeAiSessionId?: string;
  controlSessionId?: string;
  sessionUrl?: string;
  remoteControlInfo?: unknown;
  bridgePointer?: unknown;
}

export interface ClientInfo {
  name: string;
  connectedAt: string;
  lastSeenAt: string;
  online: boolean;
  knownSessions: unknown[];
  pinnedSessions: PinnedSession[];
}

interface PersistedClient {
  name: string;
  connectedAt?: string;
  lastSeenAt?: string;
  knownSessions?: unknown[];
  pinnedSessions?: PinnedSession[];
  // Legacy persisted field names; read for migration, do not write.
  reportedSessions?: unknown[];
  desiredSessions?: PinnedSession[];
}

interface PersistedState {
  clients?: Record<string, PersistedClient>;
}

interface PendingAck {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  timer: NodeJS.Timeout;
  command: RemoteCommand;
  clientName: string;
}

export interface RemoteControlStateOptions {
  stateFile: string;
  pollTimeoutMs?: number;
  ackTimeoutMs?: number;
  offlineAfterMs?: number;
}

export class RemoteControlState {
  private readonly stateFile: string;
  private readonly pollTimeoutMs: number;
  private readonly ackTimeoutMs: number;
  private readonly offlineAfterMs: number;
  private clients = new Map<string, ClientInfo>();
  private queues = new Map<string, RemoteCommand[]>();
  private waiters = new Map<string, Array<(command: RemoteCommand | null) => void>>();
  private pending = new Map<string, PendingAck>();

  constructor(options: RemoteControlStateOptions) {
    this.stateFile = options.stateFile;
    this.pollTimeoutMs = options.pollTimeoutMs ?? 25_000;
    this.ackTimeoutMs = options.ackTimeoutMs ?? 60_000;
    this.offlineAfterMs = options.offlineAfterMs ?? 60_000;
    this.load();
  }

  connectClient(input: { name: string; knownSessions?: unknown[]; reportedSessions?: unknown[] }): ClientInfo {
    const name = normalizeName(input.name);
    const now = new Date().toISOString();
    const prev = this.clients.get(name);
    const client: ClientInfo = {
      name,
      connectedAt: prev?.connectedAt ?? now,
      lastSeenAt: now,
      online: true,
      knownSessions: input.knownSessions ?? input.reportedSessions ?? prev?.knownSessions ?? [],
      pinnedSessions: prev?.pinnedSessions ?? [],
    };
    this.clients.set(name, client);
    this.save();

    for (const session of client.pinnedSessions.filter((s) => s.remoteControl)) {
      this.enqueueFireAndForget(name, "resume", {
        sessionId: session.sessionId,
        cwd: session.cwd,
        name: session.name,
        remoteControl: true,
      });
    }
    return { ...client, pinnedSessions: [...client.pinnedSessions] };
  }

  disconnectClient(nameInput: string): void {
    const name = normalizeName(nameInput);
    const prev = this.clients.get(name);
    if (!prev) return;
    this.clients.set(name, { ...prev, online: false, lastSeenAt: new Date().toISOString() });
    this.releaseWaiters(name);
    this.save();
  }

  reportSessions(nameInput: string, sessions: unknown[]): ClientInfo {
    const name = normalizeName(nameInput);
    const prev = this.clients.get(name) ?? this.connectClient({ name });
    const next = { ...prev, knownSessions: sessions, lastSeenAt: new Date().toISOString(), online: true };
    this.clients.set(name, next);
    this.save();
    return { ...next, pinnedSessions: [...next.pinnedSessions] };
  }

  listClients(): ClientInfo[] {
    const now = Date.now();
    return [...this.clients.values()].map((client) => ({
      ...client,
      online: client.online && now - Date.parse(client.lastSeenAt) < this.offlineAfterMs,
      pinnedSessions: [...client.pinnedSessions],
      knownSessions: [...client.knownSessions],
    }));
  }

  getClient(nameInput: string): ClientInfo | undefined {
    const name = normalizeName(nameInput);
    return this.listClients().find((client) => client.name === name);
  }

  pinSession(nameInput: string, session: PinnedSession): void {
    const name = normalizeName(nameInput);
    const prev = this.clients.get(name) ?? {
      name,
      connectedAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      online: false,
      knownSessions: [],
      pinnedSessions: [],
    };
    const pinned = prev.pinnedSessions.filter((s) => s.sessionId !== session.sessionId);
    pinned.push({ ...session });
    this.clients.set(name, { ...prev, pinnedSessions: pinned });
    this.save();
  }

  forgetPinnedSession(nameInput: string, sessionId: string): void {
    const name = normalizeName(nameInput);
    const prev = this.clients.get(name);
    if (!prev) return;
    this.clients.set(name, {
      ...prev,
      pinnedSessions: prev.pinnedSessions.filter((s) => s.sessionId !== sessionId),
    });
    this.save();
  }

  /**
   * Delete a single known session from a client.
   * Returns true if found and deleted, false otherwise.
   */
  deleteKnownSession(nameInput: string, sessionId: string): boolean {
    const name = normalizeName(nameInput);
    const prev = this.clients.get(name);
    if (!prev) return false;
    const before = prev.knownSessions.length;
    const sessions = prev.knownSessions.filter((s: any) => {
      const id = typeof s === "object" && s !== null ? s.sessionId ?? s.id : s;
      return id !== sessionId;
    });
    if (sessions.length === before) return false;
    // Also remove from pinned sessions
    const pinned = prev.pinnedSessions.filter((s) => s.sessionId !== sessionId);
    this.clients.set(name, { ...prev, knownSessions: sessions, pinnedSessions: pinned });
    this.save();
    return true;
  }

  /**
   * Delete all known sessions from a client.
   * Returns the count of deleted sessions.
   */
  deleteAllKnownSessions(nameInput: string): number {
    const name = normalizeName(nameInput);
    const prev = this.clients.get(name);
    if (!prev) return 0;
    const count = prev.knownSessions.length;
    this.clients.set(name, { ...prev, knownSessions: [], pinnedSessions: [] });
    this.save();
    return count;
  }

  /**
   * Delete a client record and all cached session state.
   * By default, online clients are protected because they can immediately re-report.
   */
  deleteClient(nameInput: string, options: { force?: boolean } = {}): { deleted: boolean; online?: boolean } {
    const name = normalizeName(nameInput);
    const current = this.getClient(name);
    if (!current) return { deleted: false };
    if (current.online && !options.force) return { deleted: false, online: true };

    this.clients.delete(name);
    this.queues.delete(name);
    this.releaseWaiters(name);

    for (const [commandId, pending] of this.pending.entries()) {
      if (pending.clientName !== name) continue;
      clearTimeout(pending.timer);
      pending.reject(new Error(`client deleted: ${name}`));
      this.pending.delete(commandId);
    }

    this.save();
    return { deleted: true, online: current.online };
  }

  enqueueListSessions(clientName: string): Promise<unknown> {
    return this.enqueue(normalizeName(clientName), "list-sessions", {});
  }

  enqueueStart(clientName: string, payload: { cwd: string; name?: string; text?: string }): Promise<unknown> {
    if (!payload.cwd) throw new Error("cwd required");
    return this.enqueue(normalizeName(clientName), "start", { ...payload, remoteControl: true }).then((result) => {
      const sessionId = sessionIdFromResult(result);
      if (sessionId) {
        this.pinSession(clientName, {
          sessionId,
          cwd: payload.cwd,
          name: payload.name,
          remoteControl: true,
          lastStartedAt: new Date().toISOString(),
          ...remoteControlMetadataFromResult(result),
        });
      }
      return result;
    });
  }

  enqueueResume(clientName: string, payload: { sessionId: string; cwd: string; name?: string }): Promise<unknown> {
    if (!payload.sessionId || !payload.cwd) throw new Error("sessionId and cwd required");
    const name = normalizeName(clientName);
    this.pinSession(name, {
      sessionId: payload.sessionId,
      cwd: payload.cwd,
      name: payload.name,
      remoteControl: true,
      lastStartedAt: new Date().toISOString(),
    });
    if (!this.isClientOnline(name)) {
      return Promise.resolve({ queuedForReconnect: true, sessionId: payload.sessionId });
    }
    return this.enqueue(name, "resume", { ...payload, remoteControl: true }).then((result) => {
      const sessionId = sessionIdFromResult(result) ?? payload.sessionId;
      this.pinSession(name, {
        sessionId,
        cwd: payload.cwd,
        name: payload.name,
        remoteControl: true,
        lastStartedAt: new Date().toISOString(),
        ...remoteControlMetadataFromResult(result),
      });
      return result;
    });
  }

  enqueueMessage(clientName: string, payload: { sessionId: string; text: string }): Promise<unknown> {
    if (!payload.sessionId || !payload.text) throw new Error("sessionId and text required");
    return this.enqueue(normalizeName(clientName), "message", payload);
  }

  enqueueStop(clientName: string, payload: { sessionId: string }): Promise<unknown> {
    if (!payload.sessionId) throw new Error("sessionId required");
    this.forgetPinnedSession(clientName, payload.sessionId);
    return this.enqueue(normalizeName(clientName), "stop", payload);
  }

  enqueueDisconnect(clientName: string): Promise<unknown> {
    return this.enqueue(normalizeName(clientName), "disconnect", {});
  }

  takeNextCommand(clientNameInput: string): Promise<RemoteCommand | null> {
    const clientName = normalizeName(clientNameInput);
    const client = this.clients.get(clientName);
    if (client) this.clients.set(clientName, { ...client, lastSeenAt: new Date().toISOString(), online: true });
    const queue = this.queues.get(clientName);
    if (queue?.length) return Promise.resolve(queue.shift()!);
    return new Promise((resolve) => {
      const callbacks = this.waiters.get(clientName) ?? [];
      const callback = (command: RemoteCommand | null) => {
        clearTimeout(timer);
        resolve(command);
      };
      callbacks.push(callback);
      this.waiters.set(clientName, callbacks);
      const timer = setTimeout(() => {
        const current = this.waiters.get(clientName) ?? [];
        const idx = current.indexOf(callback);
        if (idx >= 0) current.splice(idx, 1);
        resolve(null);
      }, this.pollTimeoutMs);
    });
  }

  ackCommand(commandId: string, body: { ok?: boolean; result?: unknown; error?: string }): void {
    const pending = this.pending.get(commandId);
    if (!pending) return;
    this.pending.delete(commandId);
    clearTimeout(pending.timer);
    if (body.ok === false || body.error) pending.reject(new Error(body.error ?? "command failed"));
    else pending.resolve(body.result ?? {});
  }

  private isClientOnline(clientName: string): boolean {
    const client = this.getClient(clientName);
    return client?.online === true;
  }

  private enqueue(clientName: string, type: CommandType, payload: Record<string, unknown>): Promise<unknown> {
    if (!this.clients.has(clientName)) throw new Error(`unknown client: ${clientName}`);
    const command: RemoteCommand = { id: randomUUID(), type, payload };
    const promise = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(command.id);
        reject(new Error("client did not acknowledge in time"));
      }, this.ackTimeoutMs);
      this.pending.set(command.id, { resolve, reject, timer, command, clientName });
    });
    this.deliver(clientName, command);
    return promise;
  }

  private enqueueFireAndForget(clientName: string, type: CommandType, payload: Record<string, unknown>): void {
    const command: RemoteCommand = { id: randomUUID(), type, payload };
    this.deliver(clientName, command);
  }

  private deliver(clientName: string, command: RemoteCommand): void {
    const callbacks = this.waiters.get(clientName);
    if (callbacks?.length) callbacks.shift()!(command);
    else this.queues.set(clientName, [...(this.queues.get(clientName) ?? []), command]);
  }

  private releaseWaiters(clientName: string): void {
    const callbacks = this.waiters.get(clientName) ?? [];
    while (callbacks.length) callbacks.shift()!(null);
  }

  private load(): void {
    if (!existsSync(this.stateFile)) return;
    const parsed = JSON.parse(readFileSync(this.stateFile, "utf8")) as PersistedState;
    for (const [name, client] of Object.entries(parsed.clients ?? {})) {
      this.clients.set(name, {
        name,
        connectedAt: client.connectedAt ?? new Date().toISOString(),
        lastSeenAt: client.lastSeenAt ?? new Date().toISOString(),
        online: false,
        knownSessions: client.knownSessions ?? client.reportedSessions ?? [],
        pinnedSessions: client.pinnedSessions ?? client.desiredSessions ?? [],
      });
    }
  }

  private save(): void {
    mkdirSync(path.dirname(this.stateFile), { recursive: true });
    const clients: Record<string, PersistedClient> = {};
    for (const [name, client] of this.clients.entries()) {
      clients[name] = {
        name,
        connectedAt: client.connectedAt,
        lastSeenAt: client.lastSeenAt,
        knownSessions: client.knownSessions,
        pinnedSessions: client.pinnedSessions,
      };
    }
    writeFileSync(this.stateFile, JSON.stringify({ clients }, null, 2));
  }
}

function normalizeName(name: string): string {
  const trimmed = name?.trim();
  if (!trimmed) throw new Error("name required");
  return trimmed;
}

function sessionIdFromResult(result: unknown): string | undefined {
  if (!result || typeof result !== "object") return undefined;
  const maybe = (result as { sessionId?: unknown }).sessionId;
  return typeof maybe === "string" && maybe ? maybe : undefined;
}

function remoteControlMetadataFromResult(result: unknown): Partial<PinnedSession> {
  if (!result || typeof result !== "object") return {};
  const source = result as Record<string, unknown>;
  const metadata: Partial<PinnedSession> = {};
  for (const key of ["claudeAiSessionId", "controlSessionId", "sessionUrl"] as const) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) metadata[key] = value;
  }
  if (source.remoteControlInfo !== undefined) metadata.remoteControlInfo = source.remoteControlInfo;
  if (source.bridgePointer !== undefined) metadata.bridgePointer = source.bridgePointer;
  return metadata;
}

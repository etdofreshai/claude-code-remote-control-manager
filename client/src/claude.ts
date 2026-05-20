import { query, renameSession } from "@anthropic-ai/claude-agent-sdk";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { ClaudeController } from "./types.js";

interface RemoteControlMetadata {
  remoteControlInfo?: unknown;
  claudeAiSessionId?: string;
  controlSessionId?: string;
  sessionUrl?: string;
  bridgePointer?: unknown;
}

interface RunningSession {
  sessionId: string;
  cwd: string;
  abort: AbortController;
  push: (message: unknown) => void;
  close: () => void;
  query: any;
  remoteControlMetadata?: RemoteControlMetadata;
}

export class ClaudeSdkController implements ClaudeController {
  private running = new Map<string, RunningSession>();

  async listSessions(): Promise<unknown[]> {
    const local = listClaudeJsonlSessions();
    const runningIds = new Set(this.running.keys());
    return local.map((session) => ({ ...session, running: runningIds.has(session.sessionId) }));
  }

  async startSession(input: { cwd: string; name?: string; text?: string }): Promise<unknown> {
    const sessionId = randomUUID();
    const session = await this.spawn({ sessionId, cwd: input.cwd, resume: false, name: input.name, text: input.text });
    return { sessionId: session.sessionId, cwd: session.cwd, name: input.name, remoteControl: true, ...session.remoteControlMetadata };
  }

  async resumeSession(input: { sessionId: string; cwd: string; name?: string }): Promise<unknown> {
    const session = await this.spawn({ sessionId: input.sessionId, cwd: input.cwd, resume: true, name: input.name });
    return { sessionId: session.sessionId, cwd: session.cwd, name: input.name, remoteControl: true, ...session.remoteControlMetadata };
  }

  async sendMessage(input: { sessionId: string; text: string }): Promise<unknown> {
    const session = this.running.get(input.sessionId);
    if (!session) throw new Error(`session not running: ${input.sessionId}`);
    session.push(userMessage(input.text));
    return { sent: true };
  }

  async stopSession(sessionId: string): Promise<unknown> {
    const session = this.running.get(sessionId);
    if (!session) return { stopped: false, reason: "not running" };
    await this.stopRunning(session);
    return { stopped: true };
  }

  async shutdown(): Promise<void> {
    const sessions = [...this.running.values()];
    await Promise.allSettled(sessions.map((session) => this.stopRunning(session)));
    this.running.clear();
  }

  private async spawn(input: { sessionId: string; cwd: string; resume: boolean; name?: string; text?: string }): Promise<RunningSession> {
    if (this.running.has(input.sessionId)) return this.running.get(input.sessionId)!;
    assertCwdExists(input.cwd);
    const stream = createMessageStream();
    const abort = new AbortController();
    if (!input.resume) stream.push(userMessage(input.text?.trim() || "Remote control session started. No reply needed."));

    const permissionMode = choosePermissionMode();
    const options: any = {
      cwd: input.cwd,
      abortController: abort,
      permissionMode,
      settingSources: ["user", "project", "local"],
      stderr: (data: string) => process.stderr.write(data),
    };
    if (permissionMode === "bypassPermissions") options.allowDangerouslySkipPermissions = true;
    if (input.resume) options.resume = input.sessionId;
    else options.sessionId = input.sessionId;
    if (input.name) options.extraArgs = { name: input.name };

    const q = query({ prompt: stream.iterable as any, options }) as any;
    const running: RunningSession = {
      sessionId: input.sessionId,
      cwd: input.cwd,
      abort,
      push: stream.push,
      close: stream.close,
      query: q,
    };
    this.running.set(input.sessionId, running);

    void this.consume(running);
    running.remoteControlMetadata = await enableRemoteControl(q, input.name, input.cwd);
    if (input.name) await tryRename(input.sessionId, input.name, input.cwd);
    return running;
  }

  private async consume(session: RunningSession): Promise<void> {
    try {
      for await (const _msg of session.query as AsyncIterable<unknown>) {
        // We intentionally do not persist transcripts in the minimal build.
      }
    } catch (err) {
      if (!session.abort.signal.aborted) console.error(`Claude session ${session.sessionId} errored`, err);
    } finally {
      this.running.delete(session.sessionId);
    }
  }

  private async stopRunning(session: RunningSession): Promise<void> {
    this.running.delete(session.sessionId);
    try { await session.query.enableRemoteControl(false); } catch (err) { console.error("disable remote control failed", err); }
    try { session.abort.abort(); } catch { /* noop */ }
    try { session.close(); } catch { /* noop */ }
  }
}

// Node's child_process.spawn fails with ENOENT when the supplied cwd doesn't
// exist — and the Claude SDK surfaces that as "native binary ... exists but
// failed to launch", which points at the wrong file. Fail early with a clear
// message instead.
function assertCwdExists(cwd: string): void {
  if (!cwd) throw new Error("cwd is empty");
  let stats;
  try {
    stats = statSync(cwd);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? "unknown";
    throw new Error(`cwd does not exist on this client: ${cwd} (${code})`);
  }
  if (!stats.isDirectory()) throw new Error(`cwd is not a directory: ${cwd}`);
}

function choosePermissionMode(): string {
  const configured = process.env.CCRC_PERMISSION_MODE?.trim();
  if (configured) return configured;
  if (typeof process.getuid === "function" && process.getuid() === 0) return "default";
  return "bypassPermissions";
}

async function enableRemoteControl(q: any, name: string | undefined, cwd: string): Promise<RemoteControlMetadata> {
  try {
    const remoteControlInfo = await q.enableRemoteControl(true, name);
    const bridgePointer = readBridgePointer(cwd);
    return summarizeRemoteControlMetadata(remoteControlInfo, bridgePointer);
  } catch (err) {
    throw new Error(`enableRemoteControl(true) failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function summarizeRemoteControlMetadata(remoteControlInfo: unknown, bridgePointer: unknown): RemoteControlMetadata {
  const values = [...collectStrings(remoteControlInfo), ...collectStrings(bridgePointer)];
  const controlSessionId = values.find((value) => /^cse_[A-Za-z0-9]+$/.test(value)) ?? toControlSessionId(values.find((value) => /^session_[A-Za-z0-9]+$/.test(value)));
  const claudeAiSessionId = values.find((value) => /^session_[A-Za-z0-9]+$/.test(value)) ?? toClaudeAiSessionId(controlSessionId);
  const sessionUrl = values.find((value) => /\/code\/(session_|cse_)[A-Za-z0-9]+/.test(value));
  return compactObject({ remoteControlInfo, bridgePointer, claudeAiSessionId, controlSessionId, sessionUrl });
}

function toClaudeAiSessionId(value: string | undefined): string | undefined {
  return value?.startsWith("cse_") ? `session_${value.slice(4)}` : value;
}

function toControlSessionId(value: string | undefined): string | undefined {
  return value?.startsWith("session_") ? `cse_${value.slice(8)}` : value;
}

function collectStrings(value: unknown): string[] {
  const strings: string[] = [];
  const seen = new Set<unknown>();
  const visit = (current: unknown) => {
    if (typeof current === "string") {
      strings.push(current);
      return;
    }
    if (!current || typeof current !== "object" || seen.has(current)) return;
    seen.add(current);
    if (Array.isArray(current)) {
      for (const item of current) visit(item);
      return;
    }
    for (const item of Object.values(current as Record<string, unknown>)) visit(item);
  };
  visit(value);
  return strings;
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

function readBridgePointer(cwd: string): unknown | undefined {
  const root = path.join(os.homedir(), ".claude", "projects");
  if (!existsSync(root)) return undefined;
  const candidates = new Set<string>([projectSlug(cwd)]);
  const resolved = safeRealpath(cwd);
  if (resolved) candidates.add(projectSlug(resolved));
  for (const slug of candidates) {
    const pointerPath = path.join(root, slug, "bridge-pointer.json");
    if (!existsSync(pointerPath)) continue;
    try {
      return JSON.parse(readFileSync(pointerPath, "utf8"));
    } catch (err) {
      console.error(`failed to read bridge pointer ${pointerPath}`, err);
    }
  }
  return undefined;
}

function projectSlug(cwd: string): string {
  return cwd.replace(/\\/g, "/").replace(/[^A-Za-z0-9]/g, "-");
}

function safeRealpath(cwd: string): string | undefined {
  try {
    return path.resolve(cwd);
  } catch {
    return undefined;
  }
}

async function tryRename(sessionId: string, name: string, cwd: string): Promise<void> {
  try {
    await renameSession(sessionId, name, { dir: cwd } as any);
  } catch (err) {
    console.error(`renameSession failed for ${sessionId}`, err);
  }
}

function userMessage(text: string): unknown {
  return {
    type: "user",
    message: { role: "user", content: text },
    parent_tool_use_id: null,
    timestamp: new Date().toISOString(),
  };
}

function createMessageStream(): { iterable: AsyncIterable<unknown>; push: (message: unknown) => void; close: () => void } {
  const queue: unknown[] = [];
  let waiter: (() => void) | null = null;
  let closed = false;
  return {
    iterable: {
      [Symbol.asyncIterator]() {
        return {
          async next(): Promise<IteratorResult<unknown>> {
            while (!queue.length) {
              if (closed) return { done: true, value: undefined };
              await new Promise<void>((resolve) => { waiter = resolve; });
              waiter = null;
            }
            return { done: false, value: queue.shift() };
          },
        };
      },
    },
    push(message: unknown) {
      queue.push(message);
      waiter?.();
    },
    close() {
      closed = true;
      waiter?.();
    },
  };
}

function listClaudeJsonlSessions(): Array<{ sessionId: string; cwd: string; updatedAt?: string; title?: string }> {
  const root = path.join(os.homedir(), ".claude", "projects");
  if (!existsSync(root)) return [];
  const sessions: Array<{ sessionId: string; cwd: string; updatedAt?: string; title?: string }> = [];
  for (const projectDir of readdirSync(root, { withFileTypes: true })) {
    if (!projectDir.isDirectory()) continue;
    const dir = path.join(root, projectDir.name);
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".jsonl")) continue;
      const sessionId = file.replace(/\.jsonl$/, "");
      const fullPath = path.join(dir, file);
      sessions.push({
        sessionId,
        cwd: projectDir.name.replace(/-/g, "/"),
        updatedAt: statSync(fullPath).mtime.toISOString(),
        title: readTitle(fullPath),
      });
    }
  }
  return sessions.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

function readTitle(file: string): string | undefined {
  try {
    const lines = readFileSync(file, "utf8").split("\n").slice(0, 20);
    for (const line of lines) {
      if (!line.trim()) continue;
      const parsed = JSON.parse(line) as any;
      const text = parsed?.summary ?? parsed?.message?.content;
      if (typeof text === "string" && text.trim()) return text.trim().slice(0, 120);
    }
  } catch {
    return undefined;
  }
  return undefined;
}

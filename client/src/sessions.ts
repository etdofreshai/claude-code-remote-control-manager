import { query } from "@anthropic-ai/claude-agent-sdk";
import { randomUUID } from "node:crypto";
import { load, save, type TrackedSession } from "./state.js";

interface RunningSession {
  sessionId: string;
  workingDirectory: string;
  abort: AbortController;
  push: (msg: any) => void;
  close: () => void;
  ready: Promise<void>;
}

const running = new Map<string, RunningSession>();
let onChange: (() => void) | null = null;

export function setChangeListener(fn: () => void): void {
  onChange = fn;
}

function notify(): void {
  onChange?.();
}

export function listTracked(): TrackedSession[] {
  return load();
}

function patch(sessionId: string, partial: Partial<TrackedSession>): void {
  const list = load();
  const idx = list.findIndex((s) => s.sessionId === sessionId);
  if (idx < 0) return;
  list[idx] = { ...list[idx], ...partial };
  save(list);
  notify();
}

function upsert(entry: TrackedSession): void {
  const list = load();
  const idx = list.findIndex((s) => s.sessionId === entry.sessionId);
  if (idx >= 0) list[idx] = { ...list[idx], ...entry };
  else list.push(entry);
  save(list);
  notify();
}

function createMessageStream() {
  const queueArr: any[] = [];
  let resolveWaiter: (() => void) | null = null;
  let closed = false;

  const stream: AsyncIterable<any> = {
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<any>> {
          while (queueArr.length === 0) {
            if (closed) return { done: true, value: undefined };
            await new Promise<void>((r) => {
              resolveWaiter = r;
            });
            resolveWaiter = null;
          }
          return { done: false, value: queueArr.shift()! };
        },
      };
    },
  };

  return {
    stream,
    push(msg: any) {
      queueArr.push(msg);
      resolveWaiter?.();
    },
    close() {
      closed = true;
      resolveWaiter?.();
    },
  };
}

function bootstrapMessage(): any {
  return {
    type: "user",
    message: { role: "user", content: "." },
    parent_tool_use_id: null,
    isSynthetic: true,
    timestamp: new Date().toISOString(),
  };
}

async function startQuery(opts: {
  sessionId: string;
  workingDirectory: string;
  resume: boolean;
}): Promise<RunningSession> {
  const { stream, push, close } = createMessageStream();
  const abort = new AbortController();
  push(bootstrapMessage());

  const queryOptions: any = {
    cwd: opts.workingDirectory,
    abortController: abort,
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    settingSources: ["user", "project", "local"],
  };
  if (opts.resume) queryOptions.resume = opts.sessionId;
  else queryOptions.sessionId = opts.sessionId;

  const q = query({ prompt: stream, options: queryOptions }) as any;

  let resolveReady!: () => void;
  let rejectReady!: (e: unknown) => void;
  const ready = new Promise<void>((res, rej) => {
    resolveReady = res;
    rejectReady = rej;
  });

  (async () => {
    try {
      for await (const msg of q as AsyncIterable<any>) {
        if (msg?.type === "system" && msg.subtype === "init") {
          try {
            await q.enableRemoteControl(true);
            patch(opts.sessionId, { status: "running" });
            resolveReady();
          } catch (err) {
            console.error(`session ${opts.sessionId}: enableRemoteControl failed`, err);
            patch(opts.sessionId, { status: "errored" });
            rejectReady(err);
          }
        }
        if (msg?.type === "assistant" || msg?.type === "user") {
          patch(opts.sessionId, { lastMessageAt: new Date().toISOString() });
        }
      }
      patch(opts.sessionId, { status: "stopped" });
    } catch (err) {
      console.error(`session ${opts.sessionId}: stream error`, err);
      patch(opts.sessionId, { status: "errored" });
    } finally {
      running.delete(opts.sessionId);
    }
  })();

  const rs: RunningSession = {
    sessionId: opts.sessionId,
    workingDirectory: opts.workingDirectory,
    abort,
    push,
    close,
    ready,
  };
  running.set(opts.sessionId, rs);
  return rs;
}

export async function startNew(workingDirectory: string): Promise<TrackedSession> {
  const sessionId = randomUUID();
  const entry: TrackedSession = {
    sessionId,
    workingDirectory,
    addedAt: new Date().toISOString(),
    status: "starting",
  };
  upsert(entry);
  const rs = await startQuery({ sessionId, workingDirectory, resume: false });
  await rs.ready;
  return { ...entry, status: "running" };
}

export async function bindExisting(
  sessionId: string,
  workingDirectory: string,
): Promise<TrackedSession> {
  const entry: TrackedSession = {
    sessionId,
    workingDirectory,
    addedAt: new Date().toISOString(),
    status: "starting",
  };
  upsert(entry);
  const rs = await startQuery({ sessionId, workingDirectory, resume: true });
  await rs.ready;
  return { ...entry, status: "running" };
}

export async function resumeAllTracked(): Promise<void> {
  const list = load();
  for (const entry of list) {
    if (running.has(entry.sessionId)) continue;
    try {
      await startQuery({
        sessionId: entry.sessionId,
        workingDirectory: entry.workingDirectory,
        resume: true,
      });
      console.log(`resumed remote-control session ${entry.sessionId}`);
    } catch (err) {
      console.error(`failed to resume ${entry.sessionId}`, err);
    }
  }
}

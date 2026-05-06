import { query, renameSession } from "@anthropic-ai/claude-agent-sdk";
import { randomUUID } from "node:crypto";
import { load, save, type TrackedSession } from "./state.js";
import { readSessionTitle } from "./list.js";

interface RunningSession {
  sessionId: string;
  workingDirectory: string;
  abort: AbortController;
  push: (msg: any) => void;
  close: () => void;
  ready: Promise<void>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (s: string) => UUID_RE.test(s);

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
  const serverUrl = process.env.SERVER_URL ?? "";
  const text = serverUrl
    ? `Session started from ${serverUrl}. No reply needed.`
    : "Session started from claude-code-remote-control-manager. No reply needed.";
  return {
    type: "user",
    message: { role: "user", content: text },
    parent_tool_use_id: null,
    isSynthetic: true,
    timestamp: new Date().toISOString(),
  };
}

async function startQuery(opts: {
  sessionId: string;
  workingDirectory: string;
  resume: boolean;
  name?: string;
}): Promise<RunningSession> {
  const { stream, push, close } = createMessageStream();
  const abort = new AbortController();
  // Bootstrap only on brand-new sessions: the SDK needs *some* input to
  // fire its init event before we can call enableRemoteControl(). Resumed
  // sessions (bind + reboot-time restore) init from existing transcript
  // state, so no synthetic message is needed.
  if (!opts.resume) push(bootstrapMessage());

  const queryOptions: any = {
    cwd: opts.workingDirectory,
    abortController: abort,
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    settingSources: ["user", "project", "local"],
    effort: (process.env.REASONING_EFFORT ?? "low") as
      | "low"
      | "medium"
      | "high"
      | "xhigh"
      | "max",
  };
  if (opts.resume) queryOptions.resume = opts.sessionId;
  else queryOptions.sessionId = opts.sessionId;
  if (opts.name) queryOptions.extraArgs = { ...(queryOptions.extraArgs ?? {}), name: opts.name };

  const q = query({ prompt: stream, options: queryOptions }) as any;

  let resolveReady!: () => void;
  let rejectReady!: (e: unknown) => void;
  const ready = new Promise<void>((res, rej) => {
    resolveReady = res;
    rejectReady = rej;
  });
  // Attach a no-op handler so a rejected ready promise without an awaiter
  // doesn't surface as an unhandled-rejection / process crash.
  ready.catch(() => {});

  let enabled = false;
  const enable = async (reason: string) => {
    if (enabled) return;
    enabled = true;
    try {
      await q.enableRemoteControl(true);
      patch(opts.sessionId, { status: "running" });
      resolveReady();
      console.log(`session ${opts.sessionId}: remote control enabled (${reason})`);
    } catch (err) {
      enabled = false;
      console.error(`session ${opts.sessionId}: enableRemoteControl failed (${reason})`, err);
      patch(opts.sessionId, { status: "errored" });
      rejectReady(err);
    }
  };

  // For resumes, the SDK may never emit a fresh `system.init` (the session
  // is already initialized). Fire enableRemoteControl after a short grace
  // period regardless. For brand-new sessions we still prefer init since
  // the bootstrap message guarantees it's coming.
  if (opts.resume) {
    setTimeout(() => {
      enable("resume-timer").catch(() => {});
    }, 1500);
  }

  (async () => {
    try {
      for await (const msg of q as AsyncIterable<any>) {
        if (msg?.type === "system" && msg.subtype === "init") {
          await enable("init");
        }
        if (msg?.type === "assistant" || msg?.type === "user") {
          patch(opts.sessionId, { lastMessageAt: new Date().toISOString() });
          // Fallback: any real traffic means the SDK is up; enable now.
          if (!enabled) await enable("first-message");
        }
      }
      patch(opts.sessionId, { status: "stopped" });
    } catch (err) {
      if (abort.signal.aborted) {
        patch(opts.sessionId, { status: "stopped" });
      } else {
        console.error(`session ${opts.sessionId}: stream error`, err);
        patch(opts.sessionId, { status: "errored" });
      }
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

async function applyName(
  sessionId: string,
  workingDirectory: string,
  name: string | undefined,
): Promise<void> {
  if (!name) return;
  try {
    await renameSession(sessionId, name, { dir: workingDirectory } as any);
    patch(sessionId, { name });
  } catch (err) {
    console.error(`session ${sessionId}: rename failed`, err);
  }
}

const ADJECTIVES = [
  "amber", "brave", "calm", "clever", "cosmic", "crisp", "daring", "eager",
  "fancy", "feral", "gentle", "happy", "jolly", "keen", "lively", "lucky",
  "mellow", "merry", "nimble", "quiet", "quirky", "rapid", "shiny", "silver",
  "snappy", "spry", "stellar", "sunny", "swift", "vivid", "witty", "zesty",
];
const NOUNS = [
  "anchor", "arrow", "beacon", "breeze", "canyon", "cipher", "comet", "delta",
  "dune", "ember", "falcon", "forge", "glade", "harbor", "jasper", "lantern",
  "meadow", "mesa", "nebula", "orbit", "otter", "pebble", "pixel", "prism",
  "quartz", "raven", "river", "shard", "spark", "tide", "vector", "willow",
];
function generateName(): string {
  const a = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const n = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${a}-${n}`;
}

export async function startNew(
  workingDirectory: string,
  name?: string,
): Promise<TrackedSession> {
  const sessionId = randomUUID();
  const finalName = name?.trim() || generateName();
  const entry: TrackedSession = {
    sessionId,
    workingDirectory,
    name: finalName,
    addedAt: new Date().toISOString(),
    status: "starting",
  };
  upsert(entry);
  startQuery({
    sessionId,
    workingDirectory,
    resume: false,
    name: finalName,
  }).catch((err) => console.error(`startNew ${sessionId} failed`, err));
  return { ...entry };
}

export async function bindExisting(
  sessionId: string,
  workingDirectory: string,
  name?: string,
): Promise<TrackedSession> {
  if (!isUuid(sessionId)) {
    throw new Error(
      `bind requires a UUID session id; got "${sessionId}". Subagent or non-UUID ids cannot be resumed.`,
    );
  }
  const resolvedName = name?.trim() || readSessionTitle(workingDirectory, sessionId);
  const entry: TrackedSession = {
    sessionId,
    workingDirectory,
    name: resolvedName,
    addedAt: new Date().toISOString(),
    status: "starting",
  };
  upsert(entry);
  // Don't push the name through the SDK on bind — only stored locally for
  // our UI. Resuming + renameSession concurrently has caused hangs; the
  // session keeps whatever title it already had on disk.
  startQuery({ sessionId, workingDirectory, resume: true }).catch((err) =>
    console.error(`bindExisting ${sessionId} failed`, err),
  );
  return { ...entry };
}

export async function renameTracked(
  sessionId: string,
  newName: string | undefined,
): Promise<TrackedSession & { sdkRename: "ok" | "timeout" | "error" | "skipped" }> {
  const list = load();
  const entry = list.find((s) => s.sessionId === sessionId);
  if (!entry) throw new Error(`session ${sessionId} not tracked`);
  let sdkRename: "ok" | "timeout" | "error" | "skipped" = "skipped";
  if (newName) {
    try {
      await Promise.race([
        renameSession(sessionId, newName, { dir: entry.workingDirectory } as any),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("renameSession timed out")), 10_000),
        ),
      ]);
      sdkRename = "ok";
    } catch (err) {
      console.error(`session ${sessionId}: SDK rename failed`, err);
      sdkRename = String(err).includes("timed out") ? "timeout" : "error";
    }
  }
  patch(sessionId, { name: newName });
  return { ...entry, name: newName, sdkRename };
}

export async function removeSession(sessionId: string): Promise<{ removed: boolean }> {
  const rs = running.get(sessionId);
  if (rs) {
    try {
      rs.abort.abort();
    } catch {}
    rs.close();
    running.delete(sessionId);
  }
  const list = load();
  const next = list.filter((s) => s.sessionId !== sessionId);
  const removed = next.length !== list.length;
  if (removed) {
    save(next);
    notify();
  }
  return { removed };
}

export async function resumeAllTracked(): Promise<void> {
  const list = load();
  const valid = list.filter((s) => isUuid(s.sessionId));
  if (valid.length !== list.length) {
    console.warn(
      `removing ${list.length - valid.length} non-UUID entries from tracked sessions`,
    );
    save(valid);
  }
  for (const entry of valid) {
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

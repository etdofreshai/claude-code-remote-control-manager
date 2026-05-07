import { renameSession } from "@anthropic-ai/claude-agent-sdk";
import { spawn as ptySpawn, type IPty } from "node-pty";
import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { load, save, type TrackedSession } from "./state.js";
import { readSessionTitle } from "./list.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (s: string) => UUID_RE.test(s);

const CLAUDE_BIN =
  process.env.CLAUDE_CODE_EXECUTABLE?.trim() || "/usr/local/bin/claude";

interface RunningSession {
  sessionId: string;
  workingDirectory: string;
  pty: IPty;
  startedAt: string;
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

function projectKey(workingDirectory: string): string {
  return workingDirectory.replace(/[\\/:]/g, "-");
}

function jsonlPathFor(sessionId: string, workingDirectory: string): string {
  return path.join(
    os.homedir(),
    ".claude",
    "projects",
    projectKey(workingDirectory),
    `${sessionId}.jsonl`,
  );
}

/** Refresh lastMessageAt from the on-disk transcript mtime. */
export function refreshLastMessageAtAll(): void {
  const list = load();
  let changed = false;
  for (const entry of list) {
    const file = jsonlPathFor(entry.sessionId, entry.workingDirectory);
    if (!existsSync(file)) continue;
    try {
      const mtime = statSync(file).mtime.toISOString();
      if (entry.lastMessageAt !== mtime) {
        entry.lastMessageAt = mtime;
        changed = true;
      }
    } catch {
      /* ignore */
    }
  }
  if (changed) save(list);
}

/** ─── pty-backed Claude Code session ─── */

const ALAUNCH_NAMES = [
  "amber", "brave", "calm", "clever", "cosmic", "crisp", "daring", "eager",
  "fancy", "feral", "gentle", "happy", "jolly", "keen", "lively", "lucky",
  "mellow", "merry", "nimble", "quiet", "quirky", "rapid", "shiny", "silver",
  "snappy", "spry", "stellar", "sunny", "swift", "vivid", "witty", "zesty",
];
const ALAUNCH_NOUNS = [
  "anchor", "arrow", "beacon", "breeze", "canyon", "cipher", "comet", "delta",
  "dune", "ember", "falcon", "forge", "glade", "harbor", "jasper", "lantern",
  "meadow", "mesa", "nebula", "orbit", "otter", "pebble", "pixel", "prism",
  "quartz", "raven", "river", "shard", "spark", "tide", "vector", "willow",
];
function generateName(): string {
  const a = ALAUNCH_NAMES[Math.floor(Math.random() * ALAUNCH_NAMES.length)];
  const n = ALAUNCH_NOUNS[Math.floor(Math.random() * ALAUNCH_NOUNS.length)];
  return `${a}-${n}`;
}

function spawnClaude(opts: {
  sessionId: string;
  workingDirectory: string;
  resume: boolean;
  name?: string;
}): RunningSession {
  const args: string[] = [];
  if (opts.resume) {
    args.push("--resume", opts.sessionId);
  } else {
    args.push("--session-id", opts.sessionId);
  }
  if (opts.name) args.push("--name", opts.name);
  args.push("--effort", process.env.REASONING_EFFORT?.trim() || "low");
  args.push("--dangerously-skip-permissions");
  // Force remote-control bridge to come up at startup so the Claude app
  // can connect without us calling enableRemoteControl() programmatically.
  args.push(
    "--settings",
    JSON.stringify({ remoteControlAtStartup: true }),
  );

  const pty = ptySpawn(CLAUDE_BIN, args, {
    name: "xterm-256color",
    cols: 120,
    rows: 40,
    cwd: opts.workingDirectory,
    env: { ...process.env, TERM: "xterm-256color" },
  });

  pty.onData(() => {
    // We don't capture output — the Claude app handles UI over remote
    // control. Updates to lastMessageAt come from the jsonl mtime watcher.
  });
  pty.onExit(({ exitCode, signal }) => {
    running.delete(opts.sessionId);
    const list = load();
    if (list.find((s) => s.sessionId === opts.sessionId)) {
      patch(opts.sessionId, {
        status: exitCode === 0 || signal ? "stopped" : "errored",
      });
    }
    console.log(
      `session ${opts.sessionId}: pty exited (code=${exitCode}, signal=${signal})`,
    );
  });

  const rs: RunningSession = {
    sessionId: opts.sessionId,
    workingDirectory: opts.workingDirectory,
    pty,
    startedAt: new Date().toISOString(),
  };
  running.set(opts.sessionId, rs);
  patch(opts.sessionId, { status: "running" });
  return rs;
}

async function killSession(sessionId: string): Promise<void> {
  const rs = running.get(sessionId);
  if (!rs) return;
  running.delete(sessionId);
  try {
    rs.pty.kill("SIGTERM");
  } catch {
    /* ignore */
  }
  // Give the binary a moment to release file locks.
  await new Promise((r) => setTimeout(r, 400));
  try {
    rs.pty.kill("SIGKILL");
  } catch {
    /* ignore */
  }
}

/** ─── public API used by index.ts ─── */

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
  spawnClaude({
    sessionId,
    workingDirectory,
    resume: false,
    name: finalName,
  });
  return { ...entry, status: "running" };
}

export async function bindExisting(
  sessionId: string,
  workingDirectory: string,
  name?: string,
): Promise<TrackedSession> {
  if (!isUuid(sessionId)) {
    throw new Error(
      `bind requires a UUID session id; got "${sessionId}".`,
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
  spawnClaude({
    sessionId,
    workingDirectory,
    resume: true,
    name: resolvedName,
  });
  return { ...entry, status: "running" };
}

export async function removeSession(
  sessionId: string,
): Promise<{ removed: boolean }> {
  await killSession(sessionId);
  const list = load();
  const next = list.filter((s) => s.sessionId !== sessionId);
  const removed = next.length !== list.length;
  if (removed) {
    save(next);
    notify();
  }
  return { removed };
}

export async function renameAny(
  sessionId: string,
  newName: string | undefined,
  workingDirectoryHint?: string,
): Promise<{ sdkRename: "ok" | "error" | "skipped"; tracked: boolean }> {
  if (!isUuid(sessionId)) throw new Error(`invalid session id: ${sessionId}`);
  const list = load();
  const tracked = list.find((s) => s.sessionId === sessionId);
  const workingDirectory = tracked?.workingDirectory ?? workingDirectoryHint;
  if (!workingDirectory) throw new Error("workingDirectory required for rename");

  // Stop the running pty so the binary releases the transcript file.
  await killSession(sessionId);

  let sdkRename: "ok" | "error" | "skipped" = "skipped";
  const trimmed = newName?.trim();
  if (trimmed) {
    try {
      await renameSession(sessionId, trimmed, { dir: workingDirectory } as any);
      sdkRename = "ok";
    } catch (err) {
      console.error(`session ${sessionId}: SDK rename failed`, err);
      sdkRename = "error";
    }
  }

  if (tracked) {
    patch(sessionId, { name: trimmed || undefined });
    spawnClaude({
      sessionId,
      workingDirectory,
      resume: true,
      name: trimmed || undefined,
    });
  }

  return { sdkRename, tracked: !!tracked };
}

export async function renameTracked(
  sessionId: string,
  newName: string | undefined,
): Promise<TrackedSession & { sdkRename: "ok" | "error" | "skipped" }> {
  const list = load();
  const entry = list.find((s) => s.sessionId === sessionId);
  if (!entry) throw new Error(`session ${sessionId} not tracked`);
  const r = await renameAny(sessionId, newName, entry.workingDirectory);
  return { ...entry, name: newName?.trim() || undefined, sdkRename: r.sdkRename };
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
      spawnClaude({
        sessionId: entry.sessionId,
        workingDirectory: entry.workingDirectory,
        resume: true,
        name: entry.name,
      });
      console.log(`resumed remote-control session ${entry.sessionId}`);
    } catch (err) {
      console.error(`failed to resume ${entry.sessionId}`, err);
    }
  }
}

export async function shutdownAll(timeoutMs = 5000): Promise<void> {
  const sessions = [...running.values()];
  if (!sessions.length) return;
  console.log(`shutdown: stopping ${sessions.length} sessions...`);
  await Promise.race([
    Promise.all(sessions.map((rs) => killSession(rs.sessionId))),
    new Promise((r) => setTimeout(r, timeoutMs)),
  ]);
  running.clear();
  console.log("shutdown: done");
}

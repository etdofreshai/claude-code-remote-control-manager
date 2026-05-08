import { renameSession } from "@anthropic-ai/claude-agent-sdk";
import { spawn as ptySpawn, type IPty } from "node-pty";
import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { load, save, type TrackedSession, type Effort } from "./state.js";
import { readSessionTitle } from "./list.js";
import { getProvider } from "./providers.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (s: string) => UUID_RE.test(s);

const CLAUDE_BIN =
  process.env.CLAUDE_CODE_EXECUTABLE?.trim() || "/usr/local/bin/claude";

const DEFAULT_PROVIDER = process.env.DEFAULT_PROVIDER?.trim() || "claude";
const DEFAULT_EFFORT = (process.env.REASONING_EFFORT?.trim() || "low") as Effort;

interface RunningSession {
  sessionId: string;
  workingDirectory: string;
  pty: IPty;
  startedAt: string;
  exited: Promise<void>;
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

function startupMessage(opts: {
  provider: string;
  model?: string;
  effort: Effort;
}): string {
  const origin = (process.env.SERVER_URL ?? "").trim() || "claude-code-remote-control-manager";
  const host = process.env.AGENT_NAME?.trim() || os.hostname();
  const modelPart = opts.model ? `${opts.provider}/${opts.model}` : opts.provider;
  return `Session started from ${origin} on host ${host} via ${modelPart} (effort: ${opts.effort}). No reply needed.`;
}

function spawnClaude(opts: {
  sessionId: string;
  workingDirectory: string;
  resume: boolean;
  name?: string;
  provider: string;
  model?: string;
  effort: Effort;
  initialMessage?: string;
}): RunningSession {
  if (!existsSync(opts.workingDirectory)) {
    throw new Error(
      `working directory does not exist on this client: ${opts.workingDirectory}`,
    );
  }

  const provider = getProvider(opts.provider);
  // (provider may be null for "claude" with no PROVIDERS_JSON entry — fine)

  // Claude Code rejects --model values it doesn't recognize. To route to
  // a non-Claude upstream (e.g. glm via LiteLLM) we leave --model blank
  // and instead set ANTHROPIC_DEFAULT_*_MODEL env vars so every tier
  // (Haiku/Sonnet/Opus) resolves to the chosen upstream alias.
  const isNativeClaude = !provider?.baseUrl;
  const passModelFlag = isNativeClaude && !!opts.model;

  const args: string[] = [];
  if (opts.resume) args.push("--resume", opts.sessionId);
  else args.push("--session-id", opts.sessionId);
  if (opts.name) args.push("--name", opts.name);
  if (passModelFlag) args.push("--model", opts.model!);
  args.push("--effort", opts.effort);
  args.push("--dangerously-skip-permissions");
  args.push("--remote-control");
  if (opts.initialMessage) args.push(opts.initialMessage);

  const env = { ...process.env, TERM: "xterm-256color" } as NodeJS.ProcessEnv;
  if (provider?.baseUrl) {
    env.ANTHROPIC_BASE_URL = provider.baseUrl;
    if (provider.authToken) env.ANTHROPIC_AUTH_TOKEN = provider.authToken;
    if (opts.model) {
      env.ANTHROPIC_DEFAULT_HAIKU_MODEL = opts.model;
      env.ANTHROPIC_DEFAULT_SONNET_MODEL = opts.model;
      env.ANTHROPIC_DEFAULT_OPUS_MODEL = opts.model;
    }
    // Stop the binary from auto-appending "[1m]" to non-Claude models.
    env.CLAUDE_CODE_DISABLE_1M_CONTEXT = "1";
  } else {
    // Native claude provider: make sure we don't inherit stale gateway
    // overrides from a parent shell.
    delete env.ANTHROPIC_BASE_URL;
    delete env.ANTHROPIC_AUTH_TOKEN;
    delete env.ANTHROPIC_DEFAULT_HAIKU_MODEL;
    delete env.ANTHROPIC_DEFAULT_SONNET_MODEL;
    delete env.ANTHROPIC_DEFAULT_OPUS_MODEL;
  }

  console.log(
    `spawn[${opts.provider}${opts.model ? "/" + opts.model : ""}@${opts.effort}]: ${CLAUDE_BIN} ${args.map((a) => (a.includes(" ") ? JSON.stringify(a) : a)).join(" ")} (cwd=${opts.workingDirectory})`,
  );

  const pty = ptySpawn(CLAUDE_BIN, args, {
    name: "xterm-256color",
    cols: 120,
    rows: 40,
    cwd: opts.workingDirectory,
    env,
  });

  let captureBytes = 0;
  let captured = "";
  pty.onData((data) => {
    if (captureBytes < 4000) {
      captured += data;
      captureBytes += data.length;
      if (captureBytes >= 4000 || captured.includes("\n\n")) {
        const text = captured.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "").trim();
        if (text) console.log(`session ${opts.sessionId} stdout: ${text.slice(0, 1200)}`);
      }
    }
  });
  let resolveExit!: () => void;
  const exited = new Promise<void>((r) => {
    resolveExit = r;
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
    resolveExit();
  });

  const rs: RunningSession = {
    sessionId: opts.sessionId,
    workingDirectory: opts.workingDirectory,
    pty,
    startedAt: new Date().toISOString(),
    exited,
  };
  running.set(opts.sessionId, rs);
  patch(opts.sessionId, { status: "running" });

  // Persist the title via a custom-title entry in the transcript so the
  // Claude app shows our chosen name instead of auto-summarizing the
  // bootstrap message. Delay so the binary has time to create the jsonl.
  if (opts.name) {
    const wantedName = opts.name;
    setTimeout(() => {
      renameSession(opts.sessionId, wantedName, {
        dir: opts.workingDirectory,
      } as any).catch((err) => {
        console.error(
          `session ${opts.sessionId}: post-spawn custom-title write failed`,
          err,
        );
      });
    }, 3000);
  }

  return rs;
}

async function killSession(
  sessionId: string,
  opts: { graceful?: boolean } = {},
): Promise<void> {
  const rs = running.get(sessionId);
  if (!rs) return;

  const wait = (ms: number) =>
    Promise.race([
      rs.exited,
      new Promise((r) => setTimeout(r, ms)),
    ]);

  if (opts.graceful) {
    // Try to make the CLI exit cleanly so the remote-control bridge
    // unregisters before the process dies.
    try {
      rs.pty.write("/exit\r");
    } catch {}
    await wait(4000);
    if (running.has(sessionId)) {
      try {
        rs.pty.kill("SIGTERM");
      } catch {}
      await wait(1500);
    }
  } else {
    try {
      rs.pty.kill("SIGTERM");
    } catch {}
    await wait(800);
  }

  if (running.has(sessionId)) {
    try {
      rs.pty.kill("SIGKILL");
    } catch {}
    running.delete(sessionId);
  }
}

/** ─── public API used by index.ts ─── */

export interface StartOpts {
  workingDirectory: string;
  name?: string;
  provider?: string;
  model?: string;
  effort?: Effort;
}

export async function startNew(opts: StartOpts): Promise<TrackedSession> {
  const sessionId = randomUUID();
  const finalName = opts.name?.trim() || generateName();
  const provider = opts.provider?.trim() || DEFAULT_PROVIDER;
  const effort = (opts.effort ?? DEFAULT_EFFORT) as Effort;
  const entry: TrackedSession = {
    sessionId,
    workingDirectory: opts.workingDirectory,
    name: finalName,
    provider,
    model: opts.model?.trim() || undefined,
    effort,
    addedAt: new Date().toISOString(),
    status: "starting",
  };
  upsert(entry);
  spawnClaude({
    sessionId,
    workingDirectory: opts.workingDirectory,
    resume: false,
    name: finalName,
    provider,
    model: entry.model,
    effort,
    // Skip initial message: it becomes the auto-summarized title in the
    // Claude app and overrides --name.
  });
  return { ...entry, status: "running" };
}

export interface BindOpts extends StartOpts {
  sessionId: string;
}

export async function bindExisting(opts: BindOpts): Promise<TrackedSession> {
  const { sessionId, workingDirectory } = opts;
  if (!isUuid(sessionId)) {
    throw new Error(`bind requires a UUID session id; got "${sessionId}".`);
  }
  const resolvedName =
    opts.name?.trim() || readSessionTitle(workingDirectory, sessionId);
  const provider = opts.provider?.trim() || DEFAULT_PROVIDER;
  const effort = (opts.effort ?? DEFAULT_EFFORT) as Effort;
  const entry: TrackedSession = {
    sessionId,
    workingDirectory,
    name: resolvedName,
    provider,
    model: opts.model?.trim() || undefined,
    effort,
    addedAt: new Date().toISOString(),
    status: "starting",
  };
  upsert(entry);
  spawnClaude({
    sessionId,
    workingDirectory,
    resume: true,
    name: resolvedName,
    provider,
    model: entry.model,
    effort,
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
      provider: tracked.provider ?? DEFAULT_PROVIDER,
      model: tracked.model,
      effort: (tracked.effort ?? DEFAULT_EFFORT) as Effort,
      // No startup message on rename — it's not a fresh session start.
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
        provider: entry.provider ?? DEFAULT_PROVIDER,
        model: entry.model,
        effort: (entry.effort ?? DEFAULT_EFFORT) as Effort,
        // No startup message on reboot resume.
      });
      console.log(`resumed remote-control session ${entry.sessionId}`);
    } catch (err) {
      console.error(`failed to resume ${entry.sessionId}`, err);
    }
  }
}

export async function shutdownAll(timeoutMs = 8000): Promise<void> {
  const sessions = [...running.values()];
  if (!sessions.length) return;
  console.log(`shutdown: stopping ${sessions.length} sessions gracefully...`);
  await Promise.race([
    Promise.all(sessions.map((rs) => killSession(rs.sessionId, { graceful: true }))),
    new Promise((r) => setTimeout(r, timeoutMs)),
  ]);
  // Force-kill anything still alive after the budget.
  const leftover = [...running.values()];
  for (const rs of leftover) {
    try {
      rs.pty.kill("SIGKILL");
    } catch {}
  }
  running.clear();
  console.log("shutdown: done");
}

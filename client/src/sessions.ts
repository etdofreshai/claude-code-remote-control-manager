import { query, renameSession } from "@anthropic-ai/claude-agent-sdk";
import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { load, save, type TrackedSession, type Effort } from "./state.js";
import { readSessionTitle } from "./list.js";
import { getProvider, resolveEndpoint } from "./providers.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (s: string) => UUID_RE.test(s);

const DEFAULT_PROVIDER = process.env.DEFAULT_PROVIDER?.trim() || "claude";
const DEFAULT_EFFORT = (process.env.REASONING_EFFORT?.trim() || "low") as Effort;

interface RunningSession {
  sessionId: string;
  workingDirectory: string;
  abort: AbortController;
  push: (msg: any) => void;
  close: () => void;
  ready: Promise<void>;
  query: any;
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

function bootstrapMessage(opts: {
  provider: string;
  model?: string;
  effort: Effort;
}): any {
  const origin = (process.env.SERVER_URL ?? "").trim() || "claude-code-remote-control-manager";
  const host = process.env.AGENT_NAME?.trim() || os.hostname();
  const modelPart = opts.model ? `${opts.provider}/${opts.model}` : opts.provider;
  const text = `Session started from ${origin} on host ${host} via ${modelPart} (effort: ${opts.effort}). No reply needed.`;
  return {
    type: "user",
    message: { role: "user", content: text },
    parent_tool_use_id: null,
    isSynthetic: true,
    timestamp: new Date().toISOString(),
  };
}

function buildEnvOverrides(opts: {
  provider: string;
  model?: string;
}): Record<string, string | undefined> {
  const { baseUrl, authToken } = resolveEndpoint(opts.provider, opts.model);
  const overrides: Record<string, string | undefined> = {};
  if (baseUrl) {
    overrides.ANTHROPIC_BASE_URL = baseUrl;
    if (authToken) overrides.ANTHROPIC_AUTH_TOKEN = authToken;
    if (opts.model) {
      overrides.ANTHROPIC_DEFAULT_HAIKU_MODEL = opts.model;
      overrides.ANTHROPIC_DEFAULT_SONNET_MODEL = opts.model;
      overrides.ANTHROPIC_DEFAULT_OPUS_MODEL = opts.model;
    }
    overrides.CLAUDE_CODE_DISABLE_1M_CONTEXT = "1";
  } else {
    // Native claude provider — clear any inherited gateway overrides.
    overrides.ANTHROPIC_BASE_URL = undefined;
    overrides.ANTHROPIC_AUTH_TOKEN = undefined;
    overrides.ANTHROPIC_DEFAULT_HAIKU_MODEL = undefined;
    overrides.ANTHROPIC_DEFAULT_SONNET_MODEL = undefined;
    overrides.ANTHROPIC_DEFAULT_OPUS_MODEL = undefined;
  }
  return overrides;
}

async function startQuery(opts: {
  sessionId: string;
  workingDirectory: string;
  resume: boolean;
  name?: string;
  provider: string;
  model?: string;
  effort: Effort;
  pushBootstrap: boolean;
}): Promise<RunningSession> {
  const { stream, push, close } = createMessageStream();
  const abort = new AbortController();

  // Bootstrap only on brand-new sessions: the SDK needs *some* input to
  // fire its init event before we can call enableRemoteControl(). Resumed
  // sessions (bind + reboot-time restore) init from existing transcript
  // state, so no synthetic message is needed.
  if (!opts.resume && opts.pushBootstrap) {
    push(bootstrapMessage({ provider: opts.provider, model: opts.model, effort: opts.effort }));
  }

  // Intercept AskUserQuestion: the picker round-trip is broken in
  // Anthropic's remote-control bridge (open issues #28508, #33625, #35125).
  // Deny it with a redirect message so the model rephrases the question
  // as a normal assistant message — which the Claude app does render
  // correctly. Auto-allow everything else (we still set bypassPermissions
  // for the rest).
  const endpoint = resolveEndpoint(opts.provider, opts.model);
  const isNativeClaudeProvider = !endpoint.baseUrl;
  // All currently-supported gateways pass web_search through to a real
  // search backend (Anthropic native, z.ai/anthropic native, bridge ->
  // chatgpt responses). So we no longer block WebSearch on non-claude
  // routes.
  const supportsWebSearch = true;
  const canUseTool = async (toolName: string, input: any) => {
    if (toolName === "AskUserQuestion") {
      const count = input?.questions?.length ?? 0;
      console.log(
        `session ${opts.sessionId}: redirecting AskUserQuestion to chat (questions=${count})`,
      );
      const totalLine =
        count > 1
          ? ` There are ${count} questions total — ask them ONE AT A TIME, waiting for the user's answer before posting the next.`
          : "";
      return {
        behavior: "deny" as const,
        message:
          "AskUserQuestion is intercepted in this remote-control session because the picker UI doesn't yet round-trip cleanly over Anthropic's JSON-streaming bridge. " +
          "Re-ask in plain assistant text using this format:\n" +
          "\n" +
          "1. Open the message with this exact disclaimer line: " +
          "\"⚠️ AskUserQuestion isn't yet supported over remote JSON streaming — answering inline.\"\n" +
          "2. Show ONE question only, followed by lettered options (a, b, c, d…) one per line, each with the option's label and a short description.\n" +
          "3. Add a final \"Or type your own answer.\" line.\n" +
          "4. Stop and wait for the user's reply." +
          totalLine +
          "\n\nDo not invoke AskUserQuestion again for this exchange.",
      };
    }
    if (toolName === "WebSearch" && !isNativeClaudeProvider && !supportsWebSearch) {
      const q = input?.query ?? "";
      console.log(
        `session ${opts.sessionId}: redirecting WebSearch to Bash (provider=${opts.provider}, query="${String(q).slice(0, 80)}")`,
      );
      return {
        behavior: "deny" as const,
        message:
          "WebSearch is unavailable on this provider — it's an Anthropic server-side tool and the current LiteLLM gateway has no equivalent backend. " +
          "Use the Bash tool to do real web fetches instead. Concrete suggestions:\n" +
          "\n" +
          "  • For news / general search: curl a results page or RSS feed (BBC, NPR, AP, Hacker News, Reddit JSON, etc.) and extract the relevant items.\n" +
          "  • For a specific URL: curl -sL <url> | sed 's/<[^>]*>//g' | head -200\n" +
          "  • For Hacker News top stories: curl -s 'https://hacker-news.firebaseio.com/v0/topstories.json' | head, then fetch /v0/item/<id>.json per id.\n" +
          "  • For DuckDuckGo HTML: curl -sL 'https://duckduckgo.com/html/?q=<urlencoded query>' and strip tags.\n" +
          "\n" +
          "Open your response with this exact disclaimer line: " +
          "\"⚠️ WebSearch isn't supported on this provider — fetching results via curl instead.\" " +
          "Then run the Bash commands you need and report the findings with source URLs. Do not invoke WebSearch again for this exchange.",
      };
    }
    return { behavior: "allow" as const, updatedInput: input };
  };

  const queryOptions: any = {
    cwd: opts.workingDirectory,
    abortController: abort,
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    settingSources: ["user", "project", "local"],
    effort: opts.effort,
    env: { ...process.env, ...buildEnvOverrides({ provider: opts.provider, model: opts.model }) },
    canUseTool,
    toolConfig: {
      askUserQuestion: { previewFormat: "html" as const },
    },
  };
  if (opts.resume) queryOptions.resume = opts.sessionId;
  else queryOptions.sessionId = opts.sessionId;
  if (opts.name) queryOptions.extraArgs = { ...(queryOptions.extraArgs ?? {}), name: opts.name };

  console.log(
    `query[${opts.provider}${opts.model ? "/" + opts.model : ""}@${opts.effort}]: sessionId=${opts.sessionId} resume=${opts.resume} cwd=${opts.workingDirectory}`,
  );

  const q = query({ prompt: stream, options: queryOptions }) as any;

  let resolveReady!: () => void;
  let rejectReady!: (e: unknown) => void;
  const ready = new Promise<void>((res, rej) => {
    resolveReady = res;
    rejectReady = rej;
  });
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

  // For resumes the SDK may never emit a fresh `system.init`; flip on
  // remote control after a grace period regardless.
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
    query: q,
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

async function killSession(sessionId: string, opts: { graceful?: boolean } = {}): Promise<void> {
  const rs = running.get(sessionId);
  if (!rs) return;
  running.delete(sessionId);
  if (opts.graceful) {
    try {
      await rs.query.enableRemoteControl(false);
    } catch (err) {
      console.error(`session ${sessionId}: enableRemoteControl(false) failed`, err);
    }
  }
  try {
    rs.abort.abort();
  } catch {}
  try {
    rs.close();
  } catch {}
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
  startQuery({
    sessionId,
    workingDirectory: opts.workingDirectory,
    resume: false,
    name: finalName,
    provider,
    model: entry.model,
    effort,
    pushBootstrap: true,
  })
    .then(async (rs) => {
      try {
        await rs.ready;
        await applyName(sessionId, opts.workingDirectory, finalName);
      } catch (err) {
        console.error(`startNew ${sessionId} init failed`, err);
      }
    })
    .catch((err) => console.error(`startNew ${sessionId} failed`, err));
  return { ...entry };
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
  startQuery({
    sessionId,
    workingDirectory,
    resume: true,
    name: resolvedName,
    provider,
    model: entry.model,
    effort,
    pushBootstrap: false,
  }).catch((err) => console.error(`bindExisting ${sessionId} failed`, err));
  return { ...entry };
}

export async function removeSession(
  sessionId: string,
): Promise<{ removed: boolean }> {
  await killSession(sessionId, { graceful: true });
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

  // Stop the running query so the SDK releases the transcript file.
  await killSession(sessionId);
  await new Promise((r) => setTimeout(r, 250));

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
    startQuery({
      sessionId,
      workingDirectory,
      resume: true,
      name: trimmed || undefined,
      provider: tracked.provider ?? DEFAULT_PROVIDER,
      model: tracked.model,
      effort: (tracked.effort ?? DEFAULT_EFFORT) as Effort,
      pushBootstrap: false,
    }).catch((err) =>
      console.error(`renameAny ${sessionId}: restart failed`, err),
    );
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

/**
 * Refresh a session: kill the running query and respawn it (resume).
 * The SDK process holds its session state in memory; when a session is
 * interacted with from elsewhere (Claude app, CLI), our cached process
 * doesn't see those new messages until it re-reads the on-disk transcript.
 * Killing + respawning forces a fresh load.
 */
/**
 * Enable or disable a tracked session.
 *  - disable: kill the running query but keep the entry in the list.
 *  - enable:  spawn (resume) the session.
 */
export async function setSessionEnabled(
  sessionId: string,
  enabled: boolean,
): Promise<{ enabled: boolean; status: string }> {
  if (!isUuid(sessionId)) throw new Error(`invalid session id: ${sessionId}`);
  const list = load();
  const entry = list.find((s) => s.sessionId === sessionId);
  if (!entry) throw new Error(`session ${sessionId} not tracked`);

  if (!enabled) {
    await killSession(sessionId);
    patch(sessionId, { enabled: false, status: "disabled" });
    return { enabled: false, status: "disabled" };
  }

  patch(sessionId, { enabled: true, status: "starting" });
  startQuery({
    sessionId,
    workingDirectory: entry.workingDirectory,
    resume: true,
    name: entry.name,
    provider: entry.provider ?? DEFAULT_PROVIDER,
    model: entry.model,
    effort: (entry.effort ?? DEFAULT_EFFORT) as Effort,
    pushBootstrap: false,
  }).catch((err) =>
    console.error(`setSessionEnabled ${sessionId}: spawn failed`, err),
  );
  return { enabled: true, status: "starting" };
}

export async function refreshSession(
  sessionId: string,
): Promise<{ refreshed: boolean }> {
  if (!isUuid(sessionId)) throw new Error(`invalid session id: ${sessionId}`);
  const list = load();
  const tracked = list.find((s) => s.sessionId === sessionId);
  if (!tracked) return { refreshed: false };

  await killSession(sessionId);
  // Brief settle so the SDK child process releases the transcript file
  // before the resume reads it.
  await new Promise((r) => setTimeout(r, 250));

  startQuery({
    sessionId,
    workingDirectory: tracked.workingDirectory,
    resume: true,
    name: tracked.name,
    provider: tracked.provider ?? DEFAULT_PROVIDER,
    model: tracked.model,
    effort: (tracked.effort ?? DEFAULT_EFFORT) as Effort,
    pushBootstrap: false,
  }).catch((err) =>
    console.error(`refreshSession ${sessionId}: restart failed`, err),
  );

  return { refreshed: true };
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
    if (entry.enabled === false) {
      console.log(`skipping disabled session ${entry.sessionId}`);
      continue;
    }
    try {
      startQuery({
        sessionId: entry.sessionId,
        workingDirectory: entry.workingDirectory,
        resume: true,
        name: entry.name,
        provider: entry.provider ?? DEFAULT_PROVIDER,
        model: entry.model,
        effort: (entry.effort ?? DEFAULT_EFFORT) as Effort,
        pushBootstrap: false,
      }).catch((err) => console.error(`resume ${entry.sessionId} failed`, err));
      console.log(`resumed remote-control session ${entry.sessionId}`);
    } catch (err) {
      console.error(`failed to resume ${entry.sessionId}`, err);
    }
  }
}

export async function shutdownAll(timeoutMs = 8000): Promise<void> {
  const sessions = [...running.values()];
  if (!sessions.length) return;
  console.log(`shutdown: gracefully disconnecting ${sessions.length} sessions...`);
  await Promise.race([
    Promise.all(sessions.map((rs) => killSession(rs.sessionId, { graceful: true }))),
    new Promise((r) => setTimeout(r, timeoutMs)),
  ]);
  running.clear();
  console.log("shutdown: done");
}

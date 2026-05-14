// Partial CLI runner: drives a session by spawning `claude -p` per turn
// instead of holding a long-lived SDK query. Exposes the same shape as the
// SDK's RunningSession so the rest of sessions.ts can treat both modes
// uniformly.
//
// Differences vs the SDK runner:
//   - AskUserQuestion is blocked via --disallowed-tools and an appended
//     system-prompt that tells the model to ask inline (mirrors the SDK
//     path's canUseTool deny+redirect).
//   - No enableRemoteControl bridge — CLI has no live control surface.
//     This is the main feature the SDK keeps that CLI loses.
//   - switchSession still works: each turn relaunches the subprocess so
//     the new env-override takes effect on the very next push.
import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { resolveEndpoint } from "./providers.js";
import { recordSdkMessage } from "./transcripts.js";

const ASK_USER_QUESTION_REDIRECT =
  "AskUserQuestion is disabled in this remote-controlled CLI session because " +
  "the picker UI doesn't round-trip through the web client. When you would " +
  "normally call AskUserQuestion, ask the user inline using this format:\n" +
  "1. Open the message with: \"⚠️ AskUserQuestion isn't supported here — answering inline.\"\n" +
  "2. Show ONE question with lettered options (a, b, c…), each on its own line with label + short description.\n" +
  "3. End with \"Or type your own answer.\" and wait for the user's reply.\n" +
  "If there are multiple questions, ask them one at a time across turns.";

export interface CliRunnerOpts {
  sessionId: string;
  workingDirectory: string;
  resume: boolean;
  name?: string;
  provider: string;
  model?: string;
  effort: string;
  onStatus?: (status: "starting" | "running" | "stopped" | "errored") => void;
  onLastMessageAt?: (iso: string) => void;
}

export interface CliRunningSession {
  sessionId: string;
  workingDirectory: string;
  abort: AbortController;
  push: (msg: any) => void;
  close: () => void;
  ready: Promise<void>;
  query: null;
}

function buildCliEnv(opts: { provider: string; model?: string }): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  const { baseUrl, authToken } = resolveEndpoint(opts.provider, opts.model);
  if (baseUrl) {
    env.ANTHROPIC_BASE_URL = baseUrl;
    if (authToken) env.ANTHROPIC_AUTH_TOKEN = authToken;
    if (opts.model) {
      env.ANTHROPIC_DEFAULT_HAIKU_MODEL = opts.model;
      env.ANTHROPIC_DEFAULT_SONNET_MODEL = opts.model;
      env.ANTHROPIC_DEFAULT_OPUS_MODEL = opts.model;
    }
    env.CLAUDE_CODE_DISABLE_1M_CONTEXT = "1";
  } else {
    delete env.ANTHROPIC_BASE_URL;
    delete env.ANTHROPIC_AUTH_TOKEN;
    delete env.ANTHROPIC_DEFAULT_HAIKU_MODEL;
    delete env.ANTHROPIC_DEFAULT_SONNET_MODEL;
    delete env.ANTHROPIC_DEFAULT_OPUS_MODEL;
  }
  return env;
}

function extractTextFromUserMsg(msg: any): string | null {
  const content = msg?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (block?.type === "text" && typeof block.text === "string") {
        parts.push(block.text);
      }
    }
    if (parts.length > 0) return parts.join("\n");
  }
  return null;
}

export function startCliRunner(opts: CliRunnerOpts): CliRunningSession {
  const abort = new AbortController();
  let firstTurn = !opts.resume;
  let queue: any[] = [];
  let busy = false;
  let active: ChildProcessByStdio<null, Readable, Readable> | null = null;
  let closed = false;

  // ready: SDK semantics — resolve as soon as the runner is willing to
  // accept pushes. For CLI there's no init handshake to wait on.
  const ready = Promise.resolve();
  opts.onStatus?.("running");

  const runOne = (msg: any) => new Promise<void>((resolve) => {
    const text = extractTextFromUserMsg(msg);
    if (!text || !text.trim()) {
      // Synthetic bootstrap messages have no useful CLI representation —
      // just record them so the transcript reflects intent and skip.
      try { recordSdkMessage(opts.sessionId, msg); } catch {}
      resolve();
      return;
    }

    const args = [
      "-p",
      "--output-format", "stream-json",
      "--verbose",
      "--dangerously-skip-permissions",
      "--disallowed-tools", "AskUserQuestion",
      "--append-system-prompt", ASK_USER_QUESTION_REDIRECT,
    ];
    if (firstTurn) {
      args.push("--session-id", opts.sessionId);
    } else {
      args.push("--resume", opts.sessionId);
    }
    args.push("--", text);

    const env = buildCliEnv({ provider: opts.provider, model: opts.model });
    const child = spawn("claude", args, {
      cwd: opts.workingDirectory,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    active = child;
    firstTurn = false;

    // Record the user message ourselves so it appears in the transcript
    // immediately (CLI's first emitted event is a system init, not the
    // user prompt echo).
    try { recordSdkMessage(opts.sessionId, msg); } catch {}

    let stdoutBuf = "";
    let stderrBuf = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBuf += chunk.toString("utf8");
      let nl: number;
      while ((nl = stdoutBuf.indexOf("\n")) >= 0) {
        const line = stdoutBuf.slice(0, nl).trim();
        stdoutBuf = stdoutBuf.slice(nl + 1);
        if (!line) continue;
        let parsed: any = null;
        try { parsed = JSON.parse(line); } catch {
          // Non-JSON line — likely a warning from the CLI; skip.
          continue;
        }
        if (parsed?.type === "assistant" || parsed?.type === "user") {
          opts.onLastMessageAt?.(new Date().toISOString());
        }
        try { recordSdkMessage(opts.sessionId, parsed); } catch (err) {
          console.error(`cli session ${opts.sessionId}: record failed`, err);
        }
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString("utf8");
    });
    child.on("error", (err) => {
      console.error(`cli session ${opts.sessionId}: spawn error`, err);
      opts.onStatus?.("errored");
    });
    child.on("close", (code) => {
      active = null;
      if (code !== 0 && !abort.signal.aborted) {
        console.error(
          `cli session ${opts.sessionId}: claude exited ${code}; stderr=${stderrBuf.slice(0, 500)}`,
        );
      }
      resolve();
    });
  });

  const drain = async () => {
    if (busy) return;
    busy = true;
    try {
      while (queue.length > 0 && !closed) {
        const msg = queue.shift();
        await runOne(msg);
      }
    } finally {
      busy = false;
      if (closed) opts.onStatus?.("stopped");
    }
  };

  const push = (msg: any) => {
    if (closed) return;
    queue.push(msg);
    void drain();
  };

  const close = () => {
    closed = true;
    queue = [];
    try { abort.abort(); } catch {}
    if (active && !active.killed) {
      try { active.kill("SIGTERM"); } catch {}
    }
    opts.onStatus?.("stopped");
  };

  abort.signal.addEventListener("abort", close, { once: true });

  return {
    sessionId: opts.sessionId,
    workingDirectory: opts.workingDirectory,
    abort,
    push,
    close,
    ready,
    query: null,
  };
}

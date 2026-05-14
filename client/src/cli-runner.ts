// Interactive CLI runner: drives a session by spawning a *single*, long-lived
// interactive `claude` process in a pseudo-terminal (node-pty) — no `-p`.
//
// Why not `claude -p`: print/headless mode (and the Agent SDK) bill against a
// separate Agent SDK credit pool rather than the interactive Claude
// subscription. Driving the real interactive TUI keeps a session counting as
// normal subscription usage.
//
// How it works:
//   - Input: user turns are injected into the PTY via bracketed paste + a
//     carriage return. Bracketed paste lets us send multi-line text without
//     the TUI treating newlines as submits or a leading "/" as a slash
//     command. Turns are serialized (one in flight at a time).
//   - Output: we do NOT scrape the ANSI TUI render for content. Interactive
//     `claude` writes the full structured transcript to
//     ~/.claude/projects/<key>/<sessionId>.jsonl — the same file the SDK
//     uses — so we tail that file and forward new lines through
//     recordSdkMessage (the same normalize path backfillFromDisk uses).
//   - Turn pacing: the only thing read from raw PTY output is the coarse
//     "esc to interrupt" busy marker the TUI re-renders while working; its
//     absence for a debounce window means the turn is done.
//   - First-run gates: the interactive TUI shows onboarding / folder-trust /
//     bypass-permissions prompts that `-p` mode skips. We pre-seed the known
//     ~/.claude.json flags AND auto-answer the prompts off the PTY as a
//     safety net, so a headless client never wedges on them.
//
// Differences vs the SDK runner:
//   - AskUserQuestion is blocked via --disallowed-tools and an appended
//     system prompt telling the model to ask inline (mirrors the SDK path's
//     canUseTool deny+redirect).
//   - No enableRemoteControl bridge — CLI has no live control surface.
//   - switchSession still works: sessions.ts kills + respawns the runner, so
//     a new env-override / --resume takes effect on the next process.
import { spawn as ptySpawn, type IPty } from "node-pty";
import {
  existsSync,
  statSync,
  openSync,
  readSync,
  closeSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { StringDecoder } from "node:string_decoder";
import os from "node:os";
import path from "node:path";
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

const CLAUDE_BIN = process.env.CLAUDE_CODE_EXECUTABLE?.trim() || "claude";

// Bracketed-paste framing — see file header for why.
const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";
const ENTER = "\r";

// While Claude works a turn, the TUI continuously re-renders a status line
// containing "esc to interrupt". Its absence for a debounce window means the
// turn is idle and the next queued turn can be sent.
const BUSY_MARKER = "interrupt";
const IDLE_DEBOUNCE_MS = 1500;
const TURN_GRACE_MS = 6000; // if we never observed "busy", send next anyway
const TURN_MAX_MS = 10 * 60 * 1000; // hard cap so a stuck turn can't wedge the queue
// Readiness: the TUI prints a flurry while it boots (welcome box, then
// background churn — marketplace install, release notes, etc.). Pasting input
// mid-churn gets eaten, so we wait for the interactive footer marker AND for
// output to go quiet afterwards.
const POST_MARKER_SETTLE_MS = 3000; // quiet window required after the TUI marker
const COLD_SETTLE_MS = 6000; // quiet window required if the marker never matches
const READY_MIN_MS = 4000; // never declare ready sooner than this after spawn
const READY_FALLBACK_MS = 30_000; // hard cap — declare ready regardless
const PROMPT_ANSWER_DELAY_MS = 400; // let a startup prompt finish rendering first
const PASTE_SUBMIT_DELAY_MS = 120; // gap between paste block and the submit CR
const POLL_INTERVAL_MS = 300;

// Startup prompts the interactive TUI can show before the main input is live.
// The TUI lays text out with cursor moves rather than spaces, so we match on
// a letters-only projection of the PTY output (see stripToLetters).
const STARTUP_PROMPTS: Array<{ id: string; marker: string; keys: string }> = [
  { id: "theme", marker: "choosethetextstyle", keys: ENTER },
  { id: "trust", marker: "trustthisfolder", keys: "1" + ENTER },
  { id: "bypass", marker: "bypasspermissionsmode", keys: "2" + ENTER },
];
// Letters-only projection of a stable footer string shown once the main TUI
// is interactive ("shift+tab to cycle").
const READY_MARKER = "shifttabtocycle";

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

// node-pty's env type rejects `undefined` values; ProcessEnv allows them.
function toStringEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
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

// Strip ESC (would break paste framing / allow ANSI injection) and normalize
// CR/CRLF to LF — newlines are fine inside a bracketed paste.
function sanitizeForPaste(text: string): string {
  return text.replace(/\x1b/g, "").replace(/\r\n?/g, "\n");
}

// Letters-only, lowercased projection — the TUI positions words with cursor
// moves rather than spaces, so this is the only reliable way to match a
// rendered phrase. ESC sequences must be stripped *first* (they contain
// letters like the SGR "m" terminator that would otherwise pollute the text);
// digits, box-drawing, spaces, etc. then drop out too.
function stripToLetters(s: string): string {
  return s
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "") // CSI sequences
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "") // OSC sequences
    .replace(/\x1b[@-_]/g, "") // other 2-byte ESC sequences
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

// Best-effort: pre-seed the ~/.claude.json flags that suppress the
// interactive TUI's first-run prompts. Idempotent; per-directory and global
// work is each done once per process. If the file is missing we create it; if
// it exists but is unparseable we bail rather than risk clobbering real auth
// state — the PTY auto-answer below is the actual reliability mechanism.
let globalConfigSeeded = false;
const projectConfigSeeded = new Set<string>();
function seedClaudeConfig(workingDirectory: string): void {
  if (globalConfigSeeded && projectConfigSeeded.has(workingDirectory)) return;
  const configPath = path.join(os.homedir(), ".claude.json");
  try {
    let cfg: any = {};
    if (existsSync(configPath)) {
      try {
        cfg = JSON.parse(readFileSync(configPath, "utf8"));
      } catch (err) {
        console.error(
          "cli runner: ~/.claude.json is unparseable, skipping config seed",
          err,
        );
        return;
      }
      if (!cfg || typeof cfg !== "object") return;
    }
    let changed = false;
    if (cfg.hasCompletedOnboarding !== true) {
      cfg.hasCompletedOnboarding = true;
      changed = true;
    }
    if (typeof cfg.theme !== "string" || !cfg.theme) {
      cfg.theme = "dark";
      changed = true;
    }
    if (cfg.bypassPermissionsModeAccepted !== true) {
      cfg.bypassPermissionsModeAccepted = true;
      changed = true;
    }
    if (!cfg.projects || typeof cfg.projects !== "object") cfg.projects = {};
    const proj = cfg.projects[workingDirectory] ?? {};
    if (proj.hasTrustDialogAccepted !== true) {
      proj.hasTrustDialogAccepted = true;
      changed = true;
    }
    if (proj.hasCompletedProjectOnboarding !== true) {
      proj.hasCompletedProjectOnboarding = true;
      changed = true;
    }
    cfg.projects[workingDirectory] = proj;
    if (changed) {
      writeFileSync(configPath, JSON.stringify(cfg, null, 2));
      console.log(
        `cli runner: seeded ~/.claude.json first-run flags for ${workingDirectory}`,
      );
    }
    globalConfigSeeded = true;
    projectConfigSeeded.add(workingDirectory);
  } catch (err) {
    console.error(
      "cli runner: failed to seed ~/.claude.json (PTY auto-answer will cover startup prompts)",
      err,
    );
  }
}

export function startCliRunner(opts: CliRunnerOpts): CliRunningSession {
  const abort = new AbortController();
  const jsonlPath = jsonlPathFor(opts.sessionId, opts.workingDirectory);

  let queue: any[] = [];
  let closed = false;
  let draining = false;
  let inputReady = false;

  // ── JSONL tailer ──────────────────────────────────────────────────────
  // On resume, start at the current EOF so we only forward *new* lines —
  // startQueryCli backfills the existing history separately. For a brand-new
  // session the file doesn't exist yet, so start at 0 and capture everything.
  let fileOffset = 0;
  if (opts.resume && existsSync(jsonlPath)) {
    try {
      fileOffset = statSync(jsonlPath).size;
    } catch {
      fileOffset = 0;
    }
  }
  const decoder = new StringDecoder("utf8");
  let lineBuf = "";

  const pollFile = (): void => {
    let size: number;
    try {
      if (!existsSync(jsonlPath)) return;
      size = statSync(jsonlPath).size;
    } catch {
      return;
    }
    if (size < fileOffset) {
      // File truncated/rotated — restart from the top.
      fileOffset = 0;
      lineBuf = "";
    }
    if (size === fileOffset) return;
    let fd: number;
    try {
      fd = openSync(jsonlPath, "r");
    } catch {
      return;
    }
    try {
      const len = size - fileOffset;
      const buf = Buffer.allocUnsafe(len);
      const read = readSync(fd, buf, 0, len, fileOffset);
      fileOffset += read;
      lineBuf += decoder.write(buf.subarray(0, read));
    } catch (err) {
      console.error(`cli session ${opts.sessionId}: jsonl read failed`, err);
      return;
    } finally {
      closeSync(fd);
    }
    let nl: number;
    while ((nl = lineBuf.indexOf("\n")) >= 0) {
      const line = lineBuf.slice(0, nl).trim();
      lineBuf = lineBuf.slice(nl + 1);
      if (!line) continue;
      let parsed: any;
      try {
        parsed = JSON.parse(line);
      } catch {
        // Partial or non-JSON line — skip.
        continue;
      }
      if (parsed?.type === "assistant" || parsed?.type === "user") {
        opts.onLastMessageAt?.(new Date().toISOString());
      }
      try {
        recordSdkMessage(opts.sessionId, parsed);
      } catch (err) {
        console.error(`cli session ${opts.sessionId}: record failed`, err);
      }
    }
  };
  const fileTimer = setInterval(pollFile, POLL_INTERVAL_MS);

  // ── spawn the interactive TUI ─────────────────────────────────────────
  seedClaudeConfig(opts.workingDirectory);

  const args: string[] = [
    "--dangerously-skip-permissions",
    "--disallowed-tools",
    "AskUserQuestion",
    "--append-system-prompt",
    ASK_USER_QUESTION_REDIRECT,
  ];
  if (opts.resume) args.push("--resume", opts.sessionId);
  else args.push("--session-id", opts.sessionId);

  const env = toStringEnv(buildCliEnv({ provider: opts.provider, model: opts.model }));
  console.log(
    `cli session ${opts.sessionId}: spawning interactive claude (${opts.resume ? "resume" : "new"}) cwd=${opts.workingDirectory}`,
  );

  let pty: IPty | null = null;
  try {
    pty = ptySpawn(CLAUDE_BIN, args, {
      name: "xterm-256color",
      cols: 120,
      rows: 40,
      cwd: opts.workingDirectory,
      env,
    });
  } catch (err) {
    console.error(`cli session ${opts.sessionId}: pty spawn threw`, err);
    clearInterval(fileTimer);
    opts.onStatus?.("errored");
    return {
      sessionId: opts.sessionId,
      workingDirectory: opts.workingDirectory,
      abort,
      push: () => {},
      close: () => {},
      ready: Promise.resolve(),
      query: null,
    };
  }
  const child = pty;
  opts.onStatus?.("running");

  // ── input drain — one turn in flight at a time ────────────────────────
  let lastBusyAt = 0;

  const waitForTurn = (sentAt: number): Promise<void> =>
    new Promise<void>((resolve) => {
      const tick = (): void => {
        if (closed || !pty) return resolve();
        const now = Date.now();
        const sawBusy = lastBusyAt >= sentAt;
        const quietFor = now - Math.max(lastBusyAt, sentAt);
        if (sawBusy && quietFor >= IDLE_DEBOUNCE_MS) return resolve();
        if (!sawBusy && now - sentAt >= TURN_GRACE_MS) return resolve();
        if (now - sentAt >= TURN_MAX_MS) {
          console.error(
            `cli session ${opts.sessionId}: turn exceeded max wait, continuing`,
          );
          return resolve();
        }
        setTimeout(tick, POLL_INTERVAL_MS);
      };
      setTimeout(tick, POLL_INTERVAL_MS);
    });

  const drain = async (): Promise<void> => {
    if (draining || !inputReady) return;
    draining = true;
    try {
      while (queue.length > 0 && !closed && pty) {
        const msg = queue.shift();
        const text = extractTextFromUserMsg(msg);
        if (!text || !text.trim()) {
          // Synthetic/empty turns have no PTY representation — record so the
          // transcript reflects intent, then skip. (Real turns are recorded
          // by the JSONL tailer, which picks up claude's own user echo.)
          console.log(
            `cli session ${opts.sessionId}: skipping empty/synthetic turn`,
          );
          try {
            recordSdkMessage(opts.sessionId, msg);
          } catch {
            /* ignore */
          }
          continue;
        }
        const payload = sanitizeForPaste(text);
        console.log(
          `cli session ${opts.sessionId}: sending turn textLen=${payload.length}`,
        );
        const sentAt = Date.now();
        try {
          child.write(PASTE_START + payload + PASTE_END);
          await new Promise((r) => setTimeout(r, PASTE_SUBMIT_DELAY_MS));
          if (closed || !pty) break;
          child.write(ENTER);
        } catch (err) {
          console.error(`cli session ${opts.sessionId}: pty write failed`, err);
          break;
        }
        await waitForTurn(sentAt);
      }
    } finally {
      draining = false;
    }
  };

  // ── readiness + startup-prompt handling + busy tracking ───────────────
  let readyResolve!: () => void;
  const ready = new Promise<void>((res) => {
    readyResolve = res;
  });

  const spawnedAt = Date.now();
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  let markerSeen = false;
  const markReady = (): void => {
    if (settleTimer) {
      clearTimeout(settleTimer);
      settleTimer = null;
    }
    if (!inputReady) {
      inputReady = true;
      readyResolve();
      console.log(`cli session ${opts.sessionId}: input ready`);
    }
    if (!closed) void drain();
  };
  // (Re)arm the quiet-settle timer. The required quiet window shrinks once the
  // interactive footer marker is seen; READY_MIN_MS keeps us from declaring
  // ready during the very first render burst.
  const armSettle = (): void => {
    if (inputReady || closed) return;
    if (settleTimer) clearTimeout(settleTimer);
    const base = markerSeen ? POST_MARKER_SETTLE_MS : COLD_SETTLE_MS;
    const delay = Math.max(base, READY_MIN_MS - (Date.now() - spawnedAt));
    settleTimer = setTimeout(markReady, delay);
  };

  let busyScanTail = "";
  let startupScan = "";
  const answeredPrompts = new Set<string>();

  child.onData((data: string) => {
    // Busy-marker tracking — used after ready for turn pacing; harmless before.
    const hay = busyScanTail + data;
    if (hay.includes(BUSY_MARKER)) lastBusyAt = Date.now();
    busyScanTail = hay.slice(-64);

    if (inputReady) return;

    // Startup phase: watch for first-run prompts and the "TUI is live" marker.
    startupScan = (startupScan + stripToLetters(data)).slice(-16_384);
    for (const prompt of STARTUP_PROMPTS) {
      if (answeredPrompts.has(prompt.id)) continue;
      if (!startupScan.includes(prompt.marker)) continue;
      answeredPrompts.add(prompt.id);
      startupScan = ""; // drop the matched render so we don't re-trigger
      console.log(
        `cli session ${opts.sessionId}: answering startup prompt "${prompt.id}"`,
      );
      setTimeout(() => {
        if (closed || !pty) return;
        try {
          child.write(prompt.keys);
        } catch (err) {
          console.error(
            `cli session ${opts.sessionId}: prompt answer write failed`,
            err,
          );
        }
      }, PROMPT_ANSWER_DELAY_MS);
    }
    if (!markerSeen && startupScan.includes(READY_MARKER)) {
      markerSeen = true;
      console.log(`cli session ${opts.sessionId}: TUI interactive marker seen`);
    }
    armSettle();
  });
  const fallbackTimer = setTimeout(markReady, READY_FALLBACK_MS);

  child.onExit(({ exitCode }) => {
    pty = null;
    clearInterval(fileTimer);
    pollFile(); // flush any final lines
    if (closed || abort.signal.aborted) {
      opts.onStatus?.("stopped");
      return;
    }
    // Interactive claude doesn't exit on its own — an unexpected exit is a
    // genuine failure. Leave it errored; sessions.ts (refresh / setEnabled /
    // resumeAllTracked) can respawn it.
    if (exitCode === 0) {
      console.log(`cli session ${opts.sessionId}: claude exited cleanly`);
      opts.onStatus?.("stopped");
    } else {
      console.error(`cli session ${opts.sessionId}: claude exited ${exitCode}`);
      opts.onStatus?.("errored");
    }
  });

  const push = (msg: any): void => {
    if (closed) return;
    queue.push(msg);
    void drain();
  };

  const close = (): void => {
    if (closed) return;
    closed = true;
    queue = [];
    clearInterval(fileTimer);
    clearTimeout(fallbackTimer);
    if (settleTimer) {
      clearTimeout(settleTimer);
      settleTimer = null;
    }
    try {
      readyResolve();
    } catch {
      /* ignore */
    }
    try {
      abort.abort();
    } catch {
      /* ignore */
    }
    const p = pty;
    pty = null;
    if (p) {
      try {
        p.kill("SIGTERM");
      } catch {
        /* ignore */
      }
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

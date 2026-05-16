// Codex SDK runner. Drives a session by handing the user prompt to
// `@openai/codex-sdk`, streaming events out, and normalizing them into
// canonical transcript messages. Exposes the same shape as the CLI runner
// so sessions.ts can treat both modes uniformly.
//
// Auth: the SDK picks up `OPENAI_API_KEY` from the environment (or whatever
// `codex login` has cached). No explicit configuration here.
//
// Sandbox: yolo mode — workspace-write + approvalPolicy=never + network on.
// Matches how the claude CLI runner is wired (--dangerously-skip-permissions).

import os from "node:os";
import path from "node:path";
import { Codex, type Thread, type ThreadEvent } from "@openai/codex-sdk";
import { appendMessages, type TranscriptMessage } from "./transcripts.js";

export interface CodexRunnerOpts {
  sessionId: string;
  workingDirectory: string;
  resume: boolean;
  /** Existing codex thread id to resume — populated by sessions.ts from state. */
  codexThreadId?: string;
  model?: string;
  effort: string;
  onStatus?: (status: "starting" | "running" | "stopped" | "errored") => void;
  onLastMessageAt?: (iso: string) => void;
  /** Fires once the codex SDK assigns/confirms a thread id, so callers can
   *  persist it on the TrackedSession for future resume. */
  onCodexThreadId?: (id: string) => void;
}

export interface CodexRunningSession {
  sessionId: string;
  workingDirectory: string;
  abort: AbortController;
  push: (msg: any) => void;
  close: () => void;
  ready: Promise<void>;
  query: null;
}

function resolveCwd(dir: string): string {
  if (!dir || dir === "~") return os.homedir();
  if (dir.startsWith("~/") || dir.startsWith("~\\")) {
    return path.join(os.homedir(), dir.slice(2));
  }
  return dir;
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

function effortToReasoning(effort: string):
  | "minimal" | "low" | "medium" | "high" | "xhigh" {
  switch (effort) {
    case "minimal":
    case "low":
    case "medium":
    case "high":
    case "xhigh":
      return effort;
    case "max":
      return "xhigh";
    default:
      return "medium";
  }
}

/** Map one codex ThreadEvent → 0+ canonical transcript messages. */
function eventToMessages(event: ThreadEvent): TranscriptMessage[] {
  const ts = new Date().toISOString();
  if (event.type === "item.completed" || event.type === "item.updated") {
    const item = event.item;
    switch (item.type) {
      case "agent_message":
        if (!item.text || !item.text.trim()) return [];
        return [{ ts, role: "assistant", kind: "text", text: item.text, id: item.id }];
      case "reasoning":
        return [{
          ts, role: "assistant", kind: "thinking",
          text: item.text, summary: "Reasoning", collapsed: true, id: item.id,
        }];
      case "command_execution":
        return [{
          ts, role: "assistant", kind: "tool",
          tool: "bash",
          args: { command: item.command },
          result: item.aggregated_output,
          status: item.status === "completed"
            ? (typeof item.exit_code === "number" && item.exit_code !== 0 ? "fail" : "ok")
            : item.status === "failed" ? "fail" : "pending",
          id: item.id,
        }];
      case "file_change":
        return [{
          ts, role: "assistant", kind: "tool",
          tool: "edit",
          args: { changes: item.changes },
          status: item.status === "completed" ? "ok" : "fail",
          id: item.id,
        }];
      case "mcp_tool_call":
        return [{
          ts, role: "assistant", kind: "tool",
          tool: `${item.server}/${item.tool}`,
          args: item.arguments,
          result: item.result ? JSON.stringify(item.result.structured_content ?? item.result.content) : item.error?.message,
          status: item.status === "completed" ? "ok" : item.status === "failed" ? "fail" : "pending",
          id: item.id,
        }];
      case "web_search":
        return [{
          ts, role: "assistant", kind: "tool",
          tool: "web_search",
          args: { query: item.query },
          status: "ok",
          id: item.id,
        }];
      case "todo_list":
        return [{
          ts, role: "assistant", kind: "tool",
          tool: "todos",
          args: { items: item.items },
          status: "ok",
          id: item.id,
        }];
      case "error":
        return [{ ts, role: "system", kind: "system", text: `[error] ${item.message}`, id: item.id }];
      default:
        return [];
    }
  }
  if (event.type === "turn.failed") {
    return [{ ts, role: "system", kind: "system", text: `[turn failed] ${event.error?.message ?? "unknown"}` }];
  }
  if (event.type === "error") {
    return [{ ts, role: "system", kind: "system", text: `[stream error] ${event.message}` }];
  }
  return [];
}

let codexSingleton: Codex | null = null;
function getCodex(): Codex {
  if (!codexSingleton) codexSingleton = new Codex();
  return codexSingleton;
}

export function startCodexRunner(opts: CodexRunnerOpts): CodexRunningSession {
  const abort = new AbortController();
  const queue: any[] = [];
  let busy = false;
  let closed = false;

  const codex = getCodex();
  const cwd = resolveCwd(opts.workingDirectory);
  let thread: Thread = opts.codexThreadId
    ? codex.resumeThread(opts.codexThreadId, {
        model: opts.model,
        workingDirectory: cwd,
        modelReasoningEffort: effortToReasoning(opts.effort),
        sandboxMode: "workspace-write",
        approvalPolicy: "never",
        networkAccessEnabled: true,
        skipGitRepoCheck: true,
      })
    : codex.startThread({
        model: opts.model,
        workingDirectory: cwd,
        modelReasoningEffort: effortToReasoning(opts.effort),
        sandboxMode: "workspace-write",
        approvalPolicy: "never",
        networkAccessEnabled: true,
        skipGitRepoCheck: true,
      });

  opts.onStatus?.("running");

  // No synthetic "Session started · model X" line — the bootstrap user
  // message ("Session started from <origin> on host <host> via …") already
  // tells the user the session is up and which model is on the other end,
  // and Claude's equivalent system.init is dropped by normalize() upstream
  // for the same reason. Recording it here would just accrete a new system
  // row every time the client restarts and rehydrates tracked sessions.

  let observedThreadId = opts.codexThreadId ?? null;

  const runOne = async (msg: any): Promise<void> => {
    const text = extractTextFromUserMsg(msg);
    if (!text || !text.trim()) {
      // Empty/synthetic — nothing to send to the SDK and nothing to record
      // (callers in sessions.ts already recordSdkMessage for any user-side
      // input they push, so a no-op here keeps records consistent).
      return;
    }
    // Don't pre-record the user message — sessions.ts records it via
    // recordSdkMessage(), and the bootstrap is recorded in startQueryCodex.
    // Recording here too would produce duplicate user rows in the transcript.

    console.log(
      `codex session ${opts.sessionId}: running turn (model=${opts.model ?? "default"}, cwd=${cwd}, textLen=${text.length})`,
    );

    try {
      const { events } = await thread.runStreamed(text, { signal: abort.signal });
      for await (const event of events) {
        if (event.type === "thread.started" && !observedThreadId) {
          observedThreadId = event.thread_id;
          opts.onCodexThreadId?.(event.thread_id);
        }
        const msgs = eventToMessages(event);
        if (msgs.length) {
          appendMessages(opts.sessionId, msgs);
          opts.onLastMessageAt?.(new Date().toISOString());
        }
      }
      // If the SDK never assigned a thread id (shouldn't happen), still surface
      // what we have so resume works on the next launch.
      if (!observedThreadId && thread.id) {
        observedThreadId = thread.id;
        opts.onCodexThreadId?.(thread.id);
      }
    } catch (err) {
      if (abort.signal.aborted) return;
      console.error(`codex session ${opts.sessionId}: turn failed`, err);
      appendMessages(opts.sessionId, [{
        ts: new Date().toISOString(),
        role: "system", kind: "system",
        text: `[turn failed] ${(err as { message?: string })?.message ?? String(err)}`,
      }]);
      opts.onStatus?.("errored");
    }
  };

  const drain = async (): Promise<void> => {
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

  const push = (msg: any): void => {
    if (closed) return;
    queue.push(msg);
    void drain();
  };

  const close = (): void => {
    if (closed) return;
    closed = true;
    queue.length = 0;
    try { abort.abort(); } catch {}
    opts.onStatus?.("stopped");
  };

  abort.signal.addEventListener("abort", close, { once: true });

  return {
    sessionId: opts.sessionId,
    workingDirectory: cwd,
    abort,
    push,
    close,
    ready: Promise.resolve(),
    query: null,
  };
}

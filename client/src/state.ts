import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface TrackedSession {
  sessionId: string;
  workingDirectory: string;
  name?: string;
  provider?: string;
  model?: string;
  effort?: Effort;
  /** false = tracked but not currently running; default true. */
  enabled?: boolean;
  addedAt: string;
  lastMessageAt?: string;
  status?: "starting" | "running" | "errored" | "stopped" | "disabled";
  /** Codex SDK thread id; populated after the first turn for provider=codex.
   *  Used to resume the same thread across client restarts. */
  codexThreadId?: string;
  /** Read-only mirror of a standalone `claude` CLI session — we tail its
   *  on-disk JSONL and replicate. Harness must never start a runner for it
   *  (it would race with the CLI for the same session file). */
  mirror?: boolean;
}

const STATE_DIR =
  process.env.CCRCM_STATE_DIR ?? path.join(os.homedir(), ".claude-remote");
const STATE_FILE = path.join(STATE_DIR, "sessions.json");

function ensureDir(): void {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
}

export function load(): TrackedSession[] {
  ensureDir();
  if (!existsSync(STATE_FILE)) return [];
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8")) as TrackedSession[];
  } catch {
    return [];
  }
}

export function save(list: TrackedSession[]): void {
  ensureDir();
  writeFileSync(STATE_FILE, JSON.stringify(list, null, 2));
}

export const STATE_PATH = STATE_FILE;

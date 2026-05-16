// Read-only mirror of standalone `claude` CLI sessions.
//
// The CLI writes each session to ~/.claude/projects/<flattened-cwd>/<id>.jsonl
// as newline-delimited JSON. When MIRROR_CLAUDE_CLI=1 is set, this module
// scans those files, registers each as a tracked session (enabled:false,
// mirror:true) so it shows up in the web UI, and tails each file for
// appended lines — normalizing the same way our SDK runners do and
// pushing via the existing transcript replication path.
//
// We never start a runner for a mirror session and never accept input for
// one — sessions.ts short-circuits on `entry.mirror`. That's important
// because two writers on the same .jsonl would corrupt the CLI's own
// session state.
//
// Tuning knobs (env):
//   MIRROR_CLAUDE_CLI=1        — enable
//   MIRROR_DAYS=7              — only mirror files modified within N days
//   MIRROR_SCAN_MS=30000       — how often to look for new .jsonl files
//   MIRROR_TAIL_MS=2000        — how often to poll tracked files for appends

import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";
import { load, save, type TrackedSession } from "./state.js";
import {
  appendMessages,
  backfillTranscript,
  normalize,
  type TranscriptMessage,
} from "./transcripts.js";

interface MirrorFile {
  sessionId: string;
  workingDirectory: string;
  filePath: string;
  /** Byte offset up to which we've already shipped messages. */
  offset: number;
  /** Leftover bytes from a half-written final line. */
  partial: string;
}

const projectsDir = path.join(os.homedir(), ".claude", "projects");
const mirrored = new Map<string, MirrorFile>();

function readMeta(
  filePath: string,
): { sessionId: string; workingDirectory: string; title?: string } | null {
  const sessionId = path.basename(filePath, ".jsonl");
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return null;
  let cwd: string | undefined;
  let title: string | undefined;
  try {
    const content = readFileSync(filePath, "utf8");
    for (const line of content.split("\n")) {
      if (!line) continue;
      let obj: any;
      try { obj = JSON.parse(line); } catch { continue; }
      if (!cwd && typeof obj.cwd === "string") cwd = obj.cwd;
      if (obj.type === "custom-title" && typeof obj.customTitle === "string") {
        title = obj.customTitle;
      }
    }
  } catch {
    return null;
  }
  if (!cwd) return null;
  return { sessionId, workingDirectory: cwd, title };
}

function upsert(entry: TrackedSession): void {
  const list = load();
  const idx = list.findIndex((s) => s.sessionId === entry.sessionId);
  if (idx >= 0) list[idx] = { ...list[idx], ...entry };
  else list.push(entry);
  save(list);
}

function parseLines(text: string): TranscriptMessage[] {
  const out: TranscriptMessage[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    let obj: any;
    try { obj = JSON.parse(line); } catch { continue; }
    out.push(...normalize(obj));
  }
  return out;
}

async function ingest(
  meta: { sessionId: string; workingDirectory: string; title?: string },
  filePath: string,
): Promise<void> {
  // Refuse to mirror a session our harness already owns — it would
  // double-record the transcript.
  const tracked = load().find((s) => s.sessionId === meta.sessionId);
  if (tracked && !tracked.mirror) return;

  upsert({
    sessionId: meta.sessionId,
    workingDirectory: meta.workingDirectory,
    name: tracked?.name ?? meta.title,
    provider: tracked?.provider ?? "claude",
    enabled: false,
    mirror: true,
    addedAt: tracked?.addedAt ?? new Date().toISOString(),
    status: "stopped",
  });

  let content = "";
  try { content = readFileSync(filePath, "utf8"); } catch { return; }
  const messages = parseLines(content);
  if (messages.length) {
    try { await backfillTranscript(meta.sessionId, messages); }
    catch (err) { console.error(`mirror backfill ${meta.sessionId} failed`, err); }
  }

  let size = 0;
  try { size = statSync(filePath).size; } catch { /* ignore */ }

  mirrored.set(filePath, {
    sessionId: meta.sessionId,
    workingDirectory: meta.workingDirectory,
    filePath,
    offset: size,
    partial: "",
  });
  console.log(`mirror: ingested ${meta.sessionId} (${messages.length} msgs, cwd=${meta.workingDirectory})`);
}

function tailOnce(): void {
  for (const [filePath, m] of mirrored) {
    // Stop tailing if the session has been adopted out of mirror state
    // (e.g. user bound it via the harness UI).
    const t = load().find((s) => s.sessionId === m.sessionId);
    if (!t || !t.mirror) { mirrored.delete(filePath); continue; }

    let size: number;
    try { size = statSync(filePath).size; } catch { continue; }
    if (size <= m.offset) continue;

    let fd: number;
    try { fd = openSync(filePath, "r"); } catch { continue; }
    let chunk = "";
    try {
      const len = size - m.offset;
      const buf = Buffer.alloc(len);
      readSync(fd, buf, 0, len, m.offset);
      chunk = buf.toString("utf8");
    } finally {
      closeSync(fd);
    }
    m.offset = size;
    const text = m.partial + chunk;
    const lastNl = text.lastIndexOf("\n");
    if (lastNl < 0) { m.partial = text; continue; }
    const complete = text.slice(0, lastNl);
    m.partial = text.slice(lastNl + 1);
    const msgs = parseLines(complete);
    if (msgs.length) appendMessages(m.sessionId, msgs);
  }
}

function scanProjects(maxAgeDays: number): void {
  if (!existsSync(projectsDir)) return;
  const cutoff = Date.now() - maxAgeDays * 86_400_000;
  let dirs: string[];
  try { dirs = readdirSync(projectsDir); } catch { return; }
  for (const d of dirs) {
    const proj = path.join(projectsDir, d);
    let files: string[];
    try { files = readdirSync(proj); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith(".jsonl")) continue;
      const fp = path.join(proj, f);
      if (mirrored.has(fp)) continue;
      let stat;
      try { stat = statSync(fp); } catch { continue; }
      if (stat.mtimeMs < cutoff) continue;
      const meta = readMeta(fp);
      if (!meta) continue;
      ingest(meta, fp).catch((err) =>
        console.error(`mirror ingest ${meta.sessionId} failed`, err),
      );
    }
  }
}

export function startCliMirror(): void {
  if (process.env.MIRROR_CLAUDE_CLI !== "1") return;
  const maxAgeDays = Number(process.env.MIRROR_DAYS ?? 7);
  const scanMs = Number(process.env.MIRROR_SCAN_MS ?? 30_000);
  const tailMs = Number(process.env.MIRROR_TAIL_MS ?? 2_000);
  console.log(
    `claude CLI mirror enabled (lookback ${maxAgeDays}d, scan ${scanMs}ms, tail ${tailMs}ms)`,
  );
  scanProjects(maxAgeDays);
  setInterval(() => scanProjects(maxAgeDays), scanMs);
  setInterval(tailOnce, tailMs);
}

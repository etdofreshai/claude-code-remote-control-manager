// Per-session transcript store. Each session's messages live in an
// append-only JSONL file at:
//
//   <TRANSCRIPTS_DIR>/<clientName>/<sessionId>.jsonl
//
// Clients push messages as they happen (via /api/agent/transcripts/append);
// the UI reads them paginated + filtered (via /api/clients/.../messages).
//
// Storage is intentionally boring: one canonical message per line so we can
// `tail -f` it for debugging and slice by line index for cursor pagination.

import path from "node:path";
import fs from "node:fs";

export interface TranscriptMessage {
  id?: string;
  ts: string;
  role: "user" | "assistant" | "tool" | "system" | string;
  kind: "text" | "thinking" | "tool" | "attachment" | "permission" | "progress" | "system" | string;
  text?: string;
  [key: string]: unknown;
}

const TRANSCRIPTS_DIR =
  process.env.TRANSCRIPTS_DIR ?? "/app/data/transcripts";
const MAX_FILE_BYTES = Number(process.env.TRANSCRIPT_MAX_BYTES ?? 20 * 1024 * 1024); // 20 MB sanity cap per session

const NAME_RE = /^[A-Za-z0-9._-]+$/;
function safeName(name: string): string {
  if (typeof name !== "string" || name.length === 0 || name.length > 128) {
    throw new Error(`invalid name: ${String(name).slice(0, 40)}`);
  }
  if (!NAME_RE.test(name)) {
    throw new Error(`invalid characters in name: ${name}`);
  }
  return name;
}

function pathFor(clientName: string, sessionId: string): string {
  return path.join(
    TRANSCRIPTS_DIR,
    safeName(clientName),
    safeName(sessionId) + ".jsonl",
  );
}

export function appendMessages(
  clientName: string,
  sessionId: string,
  messages: TranscriptMessage[],
  replace: boolean = false,
): { written: number; total: number } {
  if (!Array.isArray(messages)) throw new Error("messages must be an array");
  // Drop anything that isn't an object — defensive, since client controls payload.
  const clean = messages.filter(
    (m): m is TranscriptMessage => m != null && typeof m === "object",
  );
  const p = pathFor(clientName, sessionId);
  fs.mkdirSync(path.dirname(p), { recursive: true });

  if (replace) {
    // Truncate first, then write — wb-style.
    const body = clean.length
      ? clean.map((m) => JSON.stringify(m)).join("\n") + "\n"
      : "";
    fs.writeFileSync(p, body, "utf8");
  } else if (clean.length) {
    // Refuse to grow beyond the cap; the client should backfill+replace
    // if it really wants to rewrite a huge transcript.
    try {
      const stat = fs.statSync(p);
      if (stat.size > MAX_FILE_BYTES) {
        throw new Error(
          `transcript ${clientName}/${sessionId} exceeds ${MAX_FILE_BYTES} bytes; backfill with replace=true to reset`,
        );
      }
    } catch (err: any) {
      if (err?.code !== "ENOENT") throw err;
    }
    const body = clean.map((m) => JSON.stringify(m)).join("\n") + "\n";
    fs.appendFileSync(p, body, "utf8");
  }

  const total = readAll(clientName, sessionId).length;
  return { written: clean.length, total };
}

export function readAll(
  clientName: string,
  sessionId: string,
): TranscriptMessage[] {
  let p: string;
  try {
    p = pathFor(clientName, sessionId);
  } catch {
    return [];
  }
  if (!fs.existsSync(p)) return [];
  const content = fs.readFileSync(p, "utf8");
  if (!content) return [];
  const out: TranscriptMessage[] = [];
  for (const line of content.split("\n")) {
    if (!line) continue;
    try {
      out.push(JSON.parse(line) as TranscriptMessage);
    } catch {
      out.push({
        ts: new Date(0).toISOString(),
        role: "system",
        kind: "system",
        text: "[malformed transcript line]",
      });
    }
  }
  return out;
}

export interface ReadOpts {
  cursor?: number;
  limit?: number;
  roles?: string[];
  search?: string;
}

export interface ReadResult {
  messages: TranscriptMessage[];
  /** number of latest-direction messages already consumed; pass back as `cursor` next call */
  cursor: number;
  hasMore: boolean;
  total: number;
}

/**
 * Most-recent-first pagination.
 *
 * `cursor`: how many of the newest matching messages the caller has already
 * received. cursor=0 means "give me the latest `limit`". cursor=50 means
 * "skip the 50 most recent, give me the next `limit` older messages".
 *
 * The returned `messages` are in chronological order (oldest of the slice
 * first) so callers can render top-down.
 */
export function readPage(
  clientName: string,
  sessionId: string,
  opts: ReadOpts,
): ReadResult {
  const all = readAll(clientName, sessionId);
  let filtered = all;

  if (opts.roles && opts.roles.length) {
    const set = new Set(opts.roles);
    filtered = filtered.filter((m) => set.has(String(m.role)));
  }
  if (opts.search) {
    const q = opts.search.toLowerCase();
    filtered = filtered.filter((m) => {
      const t = String((m as any).text ?? "").toLowerCase();
      if (t.includes(q)) return true;
      // Check tool args/result text too.
      const tool = String((m as any).tool ?? "").toLowerCase();
      if (tool.includes(q)) return true;
      const result = String((m as any).result ?? "").toLowerCase();
      if (result.includes(q)) return true;
      return false;
    });
  }

  const total = filtered.length;
  const cursor = Math.max(0, Math.floor(opts.cursor ?? 0));
  const limit = Math.max(1, Math.min(500, Math.floor(opts.limit ?? 50)));

  const endIdx = total - cursor;
  const startIdx = Math.max(0, endIdx - limit);
  const slice = filtered.slice(startIdx, endIdx);

  return {
    messages: slice,
    cursor: cursor + slice.length,
    hasMore: startIdx > 0,
    total,
  };
}

export function deleteTranscript(clientName: string, sessionId: string): boolean {
  let p: string;
  try {
    p = pathFor(clientName, sessionId);
  } catch {
    return false;
  }
  if (!fs.existsSync(p)) return false;
  fs.unlinkSync(p);
  return true;
}

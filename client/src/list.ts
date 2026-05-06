import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import os from "node:os";

export interface SessionListItem {
  sessionId: string;
  title?: string;
  lastText?: string;
  lastMessageAt: string;
}

export interface SessionListResult {
  items: SessionListItem[];
  page: number;
  pageSize: number;
  total: number;
}

function projectKey(workingDirectory: string): string {
  // Claude Code stores transcripts under ~/.claude/projects/<key>/ where
  // <key> is the absolute path with path separators (and Windows drive
  // colons) flattened to "-". Handle both POSIX and Windows paths.
  return workingDirectory.replace(/[\\/:]/g, "-");
}

export function readSessionTitle(
  workingDirectory: string,
  sessionId: string,
): string | undefined {
  const file = path.join(
    os.homedir(),
    ".claude",
    "projects",
    projectKey(workingDirectory),
    `${sessionId}.jsonl`,
  );
  if (!existsSync(file)) return undefined;
  let title: string | undefined;
  try {
    const content = readFileSync(file, "utf8");
    for (const line of content.split("\n")) {
      if (!line) continue;
      try {
        const obj = JSON.parse(line);
        if (obj?.type === "custom-title" && typeof obj.customTitle === "string") {
          title = obj.customTitle;
        }
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
  return title;
}

function extractText(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block?.type === "text" && typeof block.text === "string") return block.text;
    }
  }
  return undefined;
}

function readSession(filePath: string, sessionId: string): SessionListItem {
  const stat = statSync(filePath);
  let title: string | undefined;
  let lastText: string | undefined;
  let lastMessageAt: string = stat.mtime.toISOString();

  try {
    const content = readFileSync(filePath, "utf8");
    const lines = content.split("\n");
    for (const line of lines) {
      if (!line) continue;
      let obj: any;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      if (obj.type === "custom-title" && typeof obj.customTitle === "string") {
        title = obj.customTitle;
      }
      if (typeof obj.timestamp === "string") lastMessageAt = obj.timestamp;
      const t = extractText(obj?.message?.content);
      if (t) lastText = t;
    }
  } catch {
    /* ignore */
  }

  return {
    sessionId,
    title,
    lastText: lastText?.slice(0, 200),
    lastMessageAt,
  };
}

export function listLocalSessions(
  workingDirectory: string,
  page: number,
  pageSize: number,
  query?: string,
): SessionListResult {
  const dir = path.join(os.homedir(), ".claude", "projects", projectKey(workingDirectory));
  if (!existsSync(dir)) return { items: [], page, pageSize, total: 0 };
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const files = readdirSync(dir).filter(
    (f) => f.endsWith(".jsonl") && UUID_RE.test(f.replace(/\.jsonl$/, "")),
  );
  let all = files.map((f) => readSession(path.join(dir, f), f.replace(/\.jsonl$/, "")));
  const q = query?.trim().toLowerCase();
  if (q) {
    all = all.filter(
      (s) =>
        s.sessionId.toLowerCase().includes(q) ||
        (s.title?.toLowerCase().includes(q) ?? false) ||
        (s.lastText?.toLowerCase().includes(q) ?? false),
    );
  }
  all.sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
  const start = page * pageSize;
  return { items: all.slice(start, start + pageSize), page, pageSize, total: all.length };
}

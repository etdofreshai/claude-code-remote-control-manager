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
  return workingDirectory.replace(/\//g, "-");
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
): SessionListResult {
  const dir = path.join(os.homedir(), ".claude", "projects", projectKey(workingDirectory));
  if (!existsSync(dir)) return { items: [], page, pageSize, total: 0 };
  const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
  const all = files.map((f) => readSession(path.join(dir, f), f.replace(/\.jsonl$/, "")));
  all.sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
  const start = page * pageSize;
  return { items: all.slice(start, start + pageSize), page, pageSize, total: all.length };
}

import { query } from "@anthropic-ai/claude-agent-sdk";
import { randomUUID } from "node:crypto";

interface SessionMeta {
  sessionId: string;
  workingDirectory: string;
  createdAt: string;
  lastUsedAt: string;
}

const sessions = new Map<string, SessionMeta>();

export function listSessions(): SessionMeta[] {
  return [...sessions.values()];
}

export function getSession(id: string): SessionMeta | undefined {
  return sessions.get(id);
}

async function runQuery(opts: {
  prompt: string;
  workingDirectory: string;
  resumeSessionId?: string;
}): Promise<{ sessionId: string; response: string }> {
  const result = query({
    prompt: opts.prompt,
    options: {
      cwd: opts.workingDirectory,
      resume: opts.resumeSessionId,
    } as any,
  });

  let sessionId = opts.resumeSessionId ?? "";
  const chunks: string[] = [];

  for await (const message of result as AsyncIterable<any>) {
    if (message?.session_id && !sessionId) sessionId = message.session_id;
    if (message?.type === "assistant" && message.message?.content) {
      for (const block of message.message.content) {
        if (block.type === "text") chunks.push(block.text);
      }
    } else if (message?.type === "result" && typeof message.result === "string") {
      chunks.push(message.result);
    }
  }

  if (!sessionId) sessionId = randomUUID();
  return { sessionId, response: chunks.join("\n").trim() };
}

export async function createSession(workingDirectory: string, prompt: string) {
  const { sessionId, response } = await runQuery({ prompt, workingDirectory });
  const now = new Date().toISOString();
  sessions.set(sessionId, {
    sessionId,
    workingDirectory,
    createdAt: now,
    lastUsedAt: now,
  });
  return { sessionId, response };
}

export async function connectSession(
  sessionId: string,
  workingDirectory: string,
  prompt: string,
) {
  const { sessionId: returnedId, response } = await runQuery({
    prompt,
    workingDirectory,
    resumeSessionId: sessionId,
  });
  const id = returnedId || sessionId;
  const now = new Date().toISOString();
  const existing = sessions.get(id);
  sessions.set(id, {
    sessionId: id,
    workingDirectory,
    createdAt: existing?.createdAt ?? now,
    lastUsedAt: now,
  });
  return { sessionId: id, response };
}

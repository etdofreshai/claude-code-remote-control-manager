// Transcript replication — normalizes Claude Agent SDK messages into a
// canonical, UI-friendly shape and pushes them to the server's
// `/api/agent/transcripts/append` endpoint. Fire-and-forget; if the push
// fails (server down, etc.) we log and move on — the SDK's own session
// file on disk remains the local source of truth.

import os from "node:os";

export interface TranscriptMessage {
  id?: string;
  ts: string;
  role: "user" | "assistant" | "tool" | "system";
  kind:
    | "text"
    | "thinking"
    | "tool"
    | "attachment"
    | "permission"
    | "progress"
    | "system";
  text?: string;
  tool?: string;
  args?: unknown;
  result?: string;
  status?: "ok" | "fail" | "pending";
  attachments?: Array<{ type: string; name: string; size?: string }>;
  summary?: string;
  collapsed?: boolean;
}

const SERVER_URL = (process.env.SERVER_URL ?? "").replace(/\/+$/, "");
const CLIENT_TOKEN = process.env.CLIENT_TOKEN ?? "";
const AGENT_NAME = process.env.AGENT_NAME ?? os.hostname();

/**
 * Translate one Claude Agent SDK message into 0+ canonical transcript
 * messages. One SDK message can contain multiple content blocks
 * (text + tool_use + tool_result) which we split into separate canonical
 * entries so the UI can render and filter each independently.
 */
export function normalize(sdkMsg: any): TranscriptMessage[] {
  const ts = new Date().toISOString();
  if (!sdkMsg || typeof sdkMsg !== "object") return [];

  if (sdkMsg.type === "system") {
    const text =
      sdkMsg.subtype === "init"
        ? `Session started${sdkMsg.model ? ` · model ${sdkMsg.model}` : ""}`
        : `[${sdkMsg.subtype || "system"}]`;
    return [{ ts, role: "system", kind: "system", text }];
  }

  if (sdkMsg.type !== "user" && sdkMsg.type !== "assistant") {
    return [];
  }

  const role = sdkMsg.type as "user" | "assistant";
  const content = sdkMsg.message?.content;
  const baseId = sdkMsg.message?.id as string | undefined;

  if (typeof content === "string") {
    return [{ ts, role, kind: "text", text: content, id: baseId }];
  }
  if (!Array.isArray(content)) return [];

  const out: TranscriptMessage[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    switch (block.type) {
      case "text":
        out.push({ ts, role, kind: "text", text: String(block.text ?? ""), id: baseId });
        break;
      case "thinking":
        out.push({
          ts, role, kind: "thinking",
          text: String(block.thinking ?? block.text ?? ""),
          summary: "Reasoning",
          collapsed: true,
          id: baseId,
        });
        break;
      case "tool_use":
        out.push({
          ts, role, kind: "tool",
          tool: String(block.name ?? "tool"),
          args: block.input ?? null,
          status: "pending",
          id: String(block.id ?? baseId ?? ""),
        });
        break;
      case "tool_result": {
        let result: string;
        if (Array.isArray(block.content)) {
          result = block.content
            .map((c: any) => (typeof c === "string" ? c : c?.text ?? ""))
            .join("\n");
        } else if (typeof block.content === "string") {
          result = block.content;
        } else {
          try { result = JSON.stringify(block.content ?? ""); }
          catch { result = ""; }
        }
        out.push({
          ts, role, kind: "tool",
          tool: "(result)",
          result,
          status: block.is_error ? "fail" : "ok",
          id: String(block.tool_use_id ?? ""),
        });
        break;
      }
      case "image":
        out.push({
          ts, role, kind: "attachment",
          attachments: [{ type: "image", name: "image" }],
          id: baseId,
        });
        break;
      default:
        // Unknown block — keep it visible but minimal so we don't silently
        // drop info during early integration.
        out.push({
          ts, role, kind: "text",
          text: `[unsupported block: ${String(block.type)}]`,
          id: baseId,
        });
    }
  }
  return out;
}

async function postAppend(
  sessionId: string,
  messages: TranscriptMessage[],
  replace: boolean,
): Promise<void> {
  if (!SERVER_URL || !CLIENT_TOKEN) return;
  if (!messages.length && !replace) return;
  try {
    const res = await fetch(`${SERVER_URL}/api/agent/transcripts/append`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${CLIENT_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: AGENT_NAME, sessionId, messages, replace }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`pushTranscript ${res.status}: ${text}`);
    }
  } catch (err) {
    console.error("pushTranscript failed", err);
  }
}

/**
 * Capture a single SDK message and push it (fire-and-forget). Safe to call
 * from inside a tight for-await loop — failures are logged but never thrown,
 * and pushes never block the loop.
 */
export function recordSdkMessage(sessionId: string, sdkMsg: any): void {
  const msgs = normalize(sdkMsg);
  if (!msgs.length) return;
  postAppend(sessionId, msgs, false).catch(() => {});
}

/** Replace the entire stored transcript for a session (used for backfill). */
export function backfillTranscript(
  sessionId: string,
  messages: TranscriptMessage[],
): Promise<void> {
  return postAppend(sessionId, messages, true);
}

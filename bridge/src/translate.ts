/**
 * Translation between Anthropic /v1/messages and OpenAI /v1/responses.
 *
 * Forward (request): anthropic-messages-shape -> openai-responses-shape
 * Reverse (response): openai-responses-shape -> anthropic-messages-shape
 *
 * Coverage targets the shapes Claude Code emits over the SDK's stream-json
 * channel: text, tool_use / tool_result, server-side web_search, system
 * prompt, function-style tool definitions. Images and thinking blocks are
 * passed through best-effort.
 */

// ------------------------- types (loose) -------------------------

interface AnthropicTool {
  type?: string;
  name?: string;
  description?: string;
  input_schema?: any;
  // server-side tool extras
  max_uses?: number;
}

interface AnthropicMessage {
  role: "user" | "assistant" | "system";
  content: string | AnthropicContentBlock[];
}

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | {
      type: "tool_use";
      id: string;
      name: string;
      input: any;
    }
  | {
      type: "tool_result";
      tool_use_id: string;
      content: string | Array<{ type: "text"; text: string }>;
      is_error?: boolean;
    }
  | { type: "thinking"; thinking: string; signature?: string }
  | { type: "image"; source: any };

interface AnthropicRequest {
  model: string;
  max_tokens?: number;
  system?: string | Array<{ type: "text"; text: string }>;
  messages: AnthropicMessage[];
  tools?: AnthropicTool[];
  tool_choice?: any;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stop_sequences?: string[];
  metadata?: any;
  thinking?: any;
  stream?: boolean;
}

// ------------------------- helpers -------------------------

function asTextString(content: AnthropicMessage["content"]): string | null {
  if (typeof content === "string") return content;
  const parts: string[] = [];
  for (const c of content) {
    if (c.type === "text") parts.push(c.text);
  }
  return parts.length ? parts.join("\n") : null;
}

function flattenSystem(s: AnthropicRequest["system"]): string | undefined {
  if (!s) return undefined;
  if (typeof s === "string") return s;
  return s
    .map((p) => p.text || "")
    .filter(Boolean)
    .join("\n\n");
}

function isAnthropicWebSearchTool(t: AnthropicTool): boolean {
  if (!t || typeof t !== "object") return false;
  const ty = String(t.type ?? "");
  const nm = String(t.name ?? "");
  return ty.startsWith("web_search") || nm === "web_search";
}

// ------------------------- request translation -------------------------

export interface ResponsesRequest {
  model: string;
  input: any[];
  tools?: any[];
  instructions?: string;
  max_output_tokens?: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  metadata?: Record<string, string>;
}

export function anthropicToResponses(req: AnthropicRequest): ResponsesRequest {
  const out: ResponsesRequest = {
    model: req.model,
    input: [],
  };

  const system = flattenSystem(req.system);
  if (system) out.instructions = system;

  if (typeof req.max_tokens === "number") out.max_output_tokens = req.max_tokens;
  if (typeof req.temperature === "number") out.temperature = req.temperature;
  if (typeof req.top_p === "number") out.top_p = req.top_p;
  if (typeof req.stream === "boolean") out.stream = req.stream;

  // tools array
  if (Array.isArray(req.tools) && req.tools.length) {
    const tools: any[] = [];
    for (const t of req.tools) {
      if (isAnthropicWebSearchTool(t)) {
        tools.push({ type: "web_search" });
        continue;
      }
      if (t.name && t.input_schema) {
        tools.push({
          type: "function",
          name: t.name,
          description: t.description ?? "",
          parameters: t.input_schema ?? { type: "object", properties: {} },
        });
        continue;
      }
      // unknown — pass through as best-effort
      tools.push(t);
    }
    out.tools = tools;
  }

  // messages -> input items
  for (const msg of req.messages ?? []) {
    if (typeof msg.content === "string") {
      out.input.push({
        type: "message",
        role: msg.role,
        content: [
          {
            type: msg.role === "assistant" ? "output_text" : "input_text",
            text: msg.content,
          },
        ],
      });
      continue;
    }
    // structured content
    const textBuf: { kind: "in" | "out"; text: string }[] = [];
    const flushText = () => {
      if (!textBuf.length) return;
      const text = textBuf.map((x) => x.text).join("\n");
      out.input.push({
        type: "message",
        role: msg.role,
        content: [
          {
            type: msg.role === "assistant" ? "output_text" : "input_text",
            text,
          },
        ],
      });
      textBuf.length = 0;
    };

    for (const block of msg.content as AnthropicContentBlock[]) {
      if (block.type === "text") {
        textBuf.push({ kind: msg.role === "assistant" ? "out" : "in", text: block.text });
        continue;
      }
      if (block.type === "tool_use") {
        flushText();
        out.input.push({
          type: "function_call",
          call_id: block.id,
          name: block.name,
          arguments: JSON.stringify(block.input ?? {}),
        });
        continue;
      }
      if (block.type === "tool_result") {
        flushText();
        let outputText: string;
        if (typeof block.content === "string") outputText = block.content;
        else
          outputText = (block.content || [])
            .map((c) => (c as any).text ?? "")
            .filter(Boolean)
            .join("\n");
        out.input.push({
          type: "function_call_output",
          call_id: block.tool_use_id,
          output: outputText,
        });
        continue;
      }
      if (block.type === "thinking") {
        // Drop thinking from forward path — Responses API has its own
        // reasoning channel that's not user-controllable. Keeping it would
        // break encrypted-content invariants from upstream.
        continue;
      }
      // unknown block — best-effort drop
    }
    flushText();
  }

  return out;
}

// ------------------------- response translation -------------------------

export interface ResponsesResponse {
  id: string;
  model: string;
  output?: any[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    input_tokens_details?: { cached_tokens?: number };
    output_tokens_details?: { reasoning_tokens?: number };
  };
  error?: any;
}

export interface AnthropicResponse {
  id: string;
  type: "message";
  role: "assistant";
  model: string;
  content: any[];
  stop_reason: string | null;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

export function responsesToAnthropic(resp: ResponsesResponse): AnthropicResponse {
  const content: any[] = [];

  for (const item of resp.output ?? []) {
    if (!item || typeof item !== "object") continue;
    const ty = item.type as string;
    if (ty === "message") {
      const role = item.role ?? "assistant";
      const blocks = Array.isArray(item.content) ? item.content : [];
      for (const c of blocks) {
        if (c?.type === "output_text" && typeof c.text === "string") {
          content.push({ type: "text", text: c.text });
        } else if (c?.type === "input_text" && typeof c.text === "string") {
          // shouldn't appear in assistant output, but handle defensively
          if (role === "assistant") content.push({ type: "text", text: c.text });
        }
      }
      continue;
    }
    if (ty === "function_call") {
      let parsed: any = {};
      try {
        parsed = item.arguments ? JSON.parse(item.arguments) : {};
      } catch {
        parsed = { __raw: item.arguments };
      }
      content.push({
        type: "tool_use",
        id: item.call_id ?? item.id ?? `toolu_${Math.random().toString(36).slice(2, 10)}`,
        name: item.name,
        input: parsed,
      });
      continue;
    }
    if (ty === "web_search_call") {
      // surface as a transparent text note so users can see the search
      // happened. The Claude Code client doesn't ship a server_tool_use
      // renderer over the SDK channel, so a plain text marker is safer.
      const action = item.action ?? {};
      const tag =
        action.type === "open_page" && action.url
          ? `[web_search] opened ${action.url}`
          : action.type === "search" && action.query
            ? `[web_search] query: ${action.query}`
            : `[web_search] ${item.status ?? "completed"}`;
      content.push({ type: "text", text: tag });
      continue;
    }
    if (ty === "reasoning") {
      // Don't surface reasoning summaries — the SDK channel doesn't have
      // a stable place to display them, and they'd duplicate the assistant
      // text. Drop silently.
      continue;
    }
    // unknown item type — best-effort skip
  }

  // If we ended with no content at all, emit an empty text block so the
  // client doesn't crash on iterating an empty content array.
  if (!content.length) content.push({ type: "text", text: "" });

  // Determine stop_reason. There's no direct mapping; pick a reasonable default.
  let stopReason: string = "end_turn";
  if (content.some((c: any) => c.type === "tool_use")) stopReason = "tool_use";

  return {
    id: resp.id,
    type: "message",
    role: "assistant",
    model: resp.model,
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: resp.usage?.input_tokens ?? 0,
      output_tokens: resp.usage?.output_tokens ?? 0,
      cache_read_input_tokens: resp.usage?.input_tokens_details?.cached_tokens,
    },
  };
}

// ------------------------- streaming bridge -------------------------

/**
 * Build an Anthropic SSE event stream from a fully-resolved Anthropic
 * response. Emits the minimum sequence Claude Code expects.
 */
export function* fakeStreamFromAnthropic(resp: AnthropicResponse): Generator<string> {
  yield sse("message_start", { type: "message_start", message: { ...resp, content: [] } });
  let idx = 0;
  for (const block of resp.content) {
    yield sse("content_block_start", { type: "content_block_start", index: idx, content_block: block });
    if (block.type === "text" && block.text) {
      yield sse("content_block_delta", {
        type: "content_block_delta",
        index: idx,
        delta: { type: "text_delta", text: block.text },
      });
    }
    if (block.type === "tool_use") {
      const argsStr = JSON.stringify(block.input ?? {});
      yield sse("content_block_delta", {
        type: "content_block_delta",
        index: idx,
        delta: { type: "input_json_delta", partial_json: argsStr },
      });
    }
    yield sse("content_block_stop", { type: "content_block_stop", index: idx });
    idx++;
  }
  yield sse("message_delta", {
    type: "message_delta",
    delta: { stop_reason: resp.stop_reason, stop_sequence: null },
    usage: { output_tokens: resp.usage.output_tokens },
  });
  yield sse("message_stop", { type: "message_stop" });
}

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

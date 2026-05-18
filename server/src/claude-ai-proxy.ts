import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

const CLAUDE_AI_BASE_URL = "https://claude.ai";

const SENSITIVE_RESPONSE_HEADERS = new Set([
  "set-cookie",
  "authorization",
  "proxy-authenticate",
  "www-authenticate",
]);

interface ProxyOptions {
  method: "GET" | "POST";
  upstreamPath: string;
  body?: unknown;
  query?: Record<string, unknown>;
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function requireForwardedClaudeAuth(req: FastifyRequest): Headers {
  const cookie = firstHeader(req.headers["x-claude-ai-cookie"]);
  const authorization = firstHeader(req.headers["x-claude-ai-authorization"]);

  if (!cookie && !authorization) {
    throw Object.assign(new Error("missing forwarded Claude.ai auth: pass X-Claude-AI-Cookie or X-Claude-AI-Authorization"), { statusCode: 400 });
  }

  const headers = new Headers({
    accept: "application/json",
    "content-type": "application/json",
    "user-agent": firstHeader(req.headers["user-agent"]) ?? "ccrc-server/0.1",
  });

  if (cookie) headers.set("cookie", cookie);
  if (authorization) headers.set("authorization", authorization);

  const organizationUuid = firstHeader(req.headers["x-claude-ai-organization-uuid"]);
  if (organizationUuid) headers.set("x-organization-uuid", organizationUuid);

  const anthropicClientPlatform = firstHeader(req.headers["x-claude-ai-client-platform"]);
  if (anthropicClientPlatform) headers.set("anthropic-client-platform", anthropicClientPlatform);

  return headers;
}

function appendQuery(url: URL, query?: Record<string, unknown>) {
  if (!query) return;
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, String(item));
    } else {
      url.searchParams.set(key, String(value));
    }
  }
}

function safeSessionId(id: string): string {
  if (!/^session_[A-Za-z0-9]+$/.test(id)) {
    throw Object.assign(new Error("invalid Claude.ai session id"), { statusCode: 400 });
  }
  return id;
}

function safeControlSessionId(id: string): string {
  if (!/^cse_[A-Za-z0-9]+$/.test(id)) {
    throw Object.assign(new Error("invalid Claude.ai control session id"), { statusCode: 400 });
  }
  return id;
}

async function proxyClaudeAi(req: FastifyRequest, reply: FastifyReply, options: ProxyOptions) {
  const headers = requireForwardedClaudeAuth(req);
  const url = new URL(options.upstreamPath, CLAUDE_AI_BASE_URL);
  appendQuery(url, options.query);

  const upstream = await fetch(url, {
    method: options.method,
    headers,
    body: options.method === "POST" ? JSON.stringify(options.body ?? {}) : undefined,
  });

  const contentType = upstream.headers.get("content-type") ?? "application/json";
  reply.code(upstream.status).type(contentType);

  for (const [name, value] of upstream.headers.entries()) {
    if (SENSITIVE_RESPONSE_HEADERS.has(name.toLowerCase())) continue;
    if (["content-type", "content-length", "transfer-encoding", "content-encoding"].includes(name.toLowerCase())) continue;
    reply.header(name, value);
  }

  const text = await upstream.text();
  if (!text) return "";

  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  return text;
}

export function registerClaudeAiProxyRoutes(app: FastifyInstance) {
  app.get("/api/claude-ai/sessions", async (req, reply) => {
    return proxyClaudeAi(req, reply, { method: "GET", upstreamPath: "/v1/sessions", query: req.query as Record<string, unknown> });
  });

  app.get("/api/claude-ai/sessions/:sessionId", async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string };
    return proxyClaudeAi(req, reply, { method: "GET", upstreamPath: `/v1/sessions/${safeSessionId(sessionId)}` });
  });

  app.get("/api/claude-ai/sessions/:sessionId/events", async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string };
    return proxyClaudeAi(req, reply, { method: "GET", upstreamPath: `/v1/sessions/${safeSessionId(sessionId)}/events`, query: req.query as Record<string, unknown> });
  });

  app.post("/api/claude-ai/sessions/:sessionId/events", async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string };
    return proxyClaudeAi(req, reply, { method: "POST", upstreamPath: `/v1/sessions/${safeSessionId(sessionId)}/events`, body: req.body ?? {} });
  });

  app.post("/api/claude-ai/code/sessions/:controlSessionId/presence", async (req, reply) => {
    const { controlSessionId } = req.params as { controlSessionId: string };
    return proxyClaudeAi(req, reply, { method: "POST", upstreamPath: `/v1/code/sessions/${safeControlSessionId(controlSessionId)}/client/presence`, body: req.body ?? {} });
  });

  app.post("/api/claude-ai/github/batch-branch-status", async (req, reply) => {
    return proxyClaudeAi(req, reply, { method: "POST", upstreamPath: "/v1/code/github/batch-branch-status", body: req.body ?? {}, query: req.query as Record<string, unknown> });
  });

  app.post("/api/claude-ai/sessions/:sessionId/git/compare", async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string };
    return proxyClaudeAi(req, reply, { method: "POST", upstreamPath: `/v1/session_ingress/session/${safeSessionId(sessionId)}/git_proxy/compare`, body: req.body ?? {} });
  });
}

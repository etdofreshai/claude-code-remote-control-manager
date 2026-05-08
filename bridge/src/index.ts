import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import {
  anthropicToResponses,
  responsesToAnthropic,
  fakeStreamFromAnthropic,
  type ResponsesResponse,
  type AnthropicResponse,
} from "./translate.js";

/**
 * Bridge service: accepts Anthropic /v1/messages requests, translates to
 * OpenAI /v1/responses, calls an upstream Responses-API endpoint
 * (typically a LiteLLM proxy), translates the response back, and returns
 * Anthropic-shape JSON or SSE.
 *
 * Why: LiteLLM's built-in /v1/messages → upstream translation only
 * targets Chat Completions for `chatgpt/*` providers, which can't run the
 * `web_search` built-in tool. Going via /v1/responses unlocks it.
 */

const PORT = Number(process.env.PORT ?? 4100);
const UPSTREAM_BASE_URL =
  process.env.UPSTREAM_BASE_URL?.trim().replace(/\/+$/, "") ||
  "https://litellm.etdofresh.com";
const UPSTREAM_AUTH_TOKEN = process.env.UPSTREAM_AUTH_TOKEN?.trim();

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });

app.get("/healthz", async () => ({ ok: true, upstream: UPSTREAM_BASE_URL }));

app.post("/v1/messages", async (req, reply) => {
  const body = req.body as any;
  if (!body || typeof body !== "object") {
    reply.code(400).send({ error: { message: "missing JSON body" } });
    return;
  }

  // Auth: prefer the inbound Authorization header; fall back to the
  // service-level UPSTREAM_AUTH_TOKEN env so the client can still drive
  // upstream auth from PROVIDERS_JSON.
  const inboundAuth = req.headers.authorization;
  const auth = (typeof inboundAuth === "string" && inboundAuth) ||
    (UPSTREAM_AUTH_TOKEN ? `Bearer ${UPSTREAM_AUTH_TOKEN}` : "");
  if (!auth) {
    reply.code(401).send({
      error: { message: "missing Authorization header and no UPSTREAM_AUTH_TOKEN" },
    });
    return;
  }

  const wantStream = body.stream === true;
  const upstreamReq = anthropicToResponses(body);
  // We always call upstream non-streaming and re-emit a fake SSE if the
  // client wanted streaming. Simpler than translating two SSE dialects.
  upstreamReq.stream = false;

  app.log.info(
    { model: upstreamReq.model, tools: upstreamReq.tools?.length ?? 0, items: upstreamReq.input.length, wantStream },
    "/v1/messages -> /v1/responses",
  );

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(`${UPSTREAM_BASE_URL}/v1/responses`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: auth,
      },
      body: JSON.stringify(upstreamReq),
    });
  } catch (err) {
    app.log.error({ err }, "upstream fetch failed");
    reply.code(502).send({
      error: { type: "bridge_error", message: `upstream fetch failed: ${String(err)}` },
    });
    return;
  }

  const text = await upstreamRes.text();
  if (!upstreamRes.ok) {
    app.log.warn({ status: upstreamRes.status, body: text.slice(0, 500) }, "upstream non-2xx");
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { error: { type: "upstream_error", message: text.slice(0, 1000) } };
    }
    reply.code(upstreamRes.status).send(parsed);
    return;
  }

  let upstream: ResponsesResponse;
  try {
    upstream = JSON.parse(text);
  } catch (err) {
    app.log.error({ err, sample: text.slice(0, 500) }, "upstream returned non-JSON");
    reply.code(502).send({
      error: { type: "bridge_error", message: "upstream returned non-JSON" },
    });
    return;
  }

  // Carry over the model the client originally asked about so Claude
  // Code's session metadata stays consistent.
  upstream.model = upstream.model ?? body.model;
  // Some LiteLLM responses lead with a base64-blob id. Replace with a clean uuid.
  if (!upstream.id || upstream.id.length > 120) upstream.id = `msg_${randomUUID()}`;

  const anthResp: AnthropicResponse = responsesToAnthropic(upstream);

  if (!wantStream) {
    reply.type("application/json").send(anthResp);
    return;
  }

  reply.raw.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  for (const chunk of fakeStreamFromAnthropic(anthResp)) {
    reply.raw.write(chunk);
  }
  reply.raw.end();
});

app.listen({ host: "0.0.0.0", port: PORT }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});

import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import websocket from "@fastify/websocket";
import { registerClaudeAiProxyRoutes } from "./claude-ai-proxy.js";
import { helpJson, helpMarkdown } from "./help.js";
import { RemoteControlState } from "./state.js";
import { resolveRemoteSession } from "./remote-session-resolver.js";

export interface CreateAppOptions {
  state: RemoteControlState;
  token: string;
}

export function createApp({ state, token }: CreateAppOptions): FastifyInstance {
  if (!token) throw new Error("token required");
  const app = Fastify({ logger: process.env.LOG_LEVEL ? { level: process.env.LOG_LEVEL } : false });
  void app.register(websocket);

  app.addHook("preHandler", async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.url === "/healthz" || req.url === "/help") return;
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${token}`) {
      reply.code(401).send({ error: "unauthorized" });
    }
  });

  app.get("/healthz", async () => ({ ok: true }));

  app.get("/help", async (_req, reply) => {
    reply.type("text/markdown; charset=utf-8");
    return helpMarkdown;
  });

  app.get("/api/help", async () => helpJson());

  registerClaudeAiProxyRoutes(app);

  void app.register(async function websocketRoutes(wsApp) {
    wsApp.get("/api/agent/ws", { websocket: true }, (socket, req) => {
    const name = (req.query as { name?: string }).name;
    if (!name) {
      socket.close(1008, "name required");
      return;
    }
    const client = state.connectClient({ name });
    const send = (message: unknown): boolean => {
      if (socket.readyState !== socket.OPEN) return false;
      socket.send(JSON.stringify(message));
      return true;
    };
    state.registerPushClient(name, (command) => send({ type: "command", command }));
    send({ type: "connected", result: client });

    socket.on("message", (raw: Buffer) => {
      try {
        const message = JSON.parse(raw.toString()) as { type?: string; id?: string; ok?: boolean; result?: unknown; error?: string; sessions?: unknown[] };
        if (message.type === "ack") {
          if (!message.id) throw new Error("id required");
          state.ackCommand(message.id, { ok: message.ok, result: message.result, error: message.error });
          return;
        }
        if (message.type === "sessions") {
          state.reportSessions(name, Array.isArray(message.sessions) ? message.sessions : []);
          return;
        }
        if (message.type === "disconnect") {
          state.disconnectClient(name);
          socket.close(1000, "client disconnect");
          return;
        }
        send({ type: "error", error: `unknown websocket message type: ${message.type ?? "missing"}` });
      } catch (err) {
        send({ type: "error", error: err instanceof Error ? err.message : String(err) });
      }
    });

    socket.on("close", () => {
      state.unregisterPushClient(name);
      state.disconnectClient(name);
    });
  });
  });

  app.get("/api/clients", async () => state.listClients());

  app.get("/api/clients/:name", async (req, reply) => {
    const { name } = req.params as { name: string };
    const client = state.getClient(name);
    if (!client) {
      reply.code(404).send({ error: `unknown client: ${name}` });
      return;
    }
    return client;
  });

  app.get("/api/clients/:name/sessions", async (req, reply) => {
    const { name } = req.params as { name: string };
    const client = state.getClient(name);
    if (!client) {
      reply.code(404).send({ error: `unknown client: ${name}` });
      return;
    }
    return {
      pinnedSessions: client.pinnedSessions,
      knownSessions: client.knownSessions,
    };
  });

  app.post("/api/clients/:name/sessions/list", async (req) => {
    const { name } = req.params as { name: string };
    return state.enqueueListSessions(name);
  });

  app.post("/api/clients/:name/sessions/new", async (req) => {
    const { name } = req.params as { name: string };
    const body = (req.body ?? {}) as { cwd?: string; name?: string; text?: string };
    if (!body.cwd) throw new Error("cwd required");
    return state.enqueueStart(name, { cwd: body.cwd, name: body.name, text: body.text });
  });

  app.post("/api/clients/:name/sessions/resume", async (req) => {
    const { name } = req.params as { name: string };
    const body = (req.body ?? {}) as { cwd?: string; sessionId?: string; name?: string };
    if (!body.cwd || !body.sessionId) throw new Error("cwd and sessionId required");
    return state.enqueueResume(name, { cwd: body.cwd, sessionId: body.sessionId, name: body.name });
  });

  app.post("/api/sessions/resolve-remote", async (req) => {
    const body = (req.body ?? {}) as { remote?: string; url?: string; client?: string };
    return resolveRemoteSession({ state, req, remote: body.remote, url: body.url, client: body.client });
  });

  app.post("/api/sessions/resume-by-remote", async (req, reply) => {
    const body = (req.body ?? {}) as { remote?: string; url?: string; client?: string; cwd?: string; name?: string };
    const resolved = await resolveRemoteSession({ state, req, remote: body.remote, url: body.url, client: body.client });
    if (!resolved.exact) {
      reply.code(resolved.ambiguous ? 409 : 404).send({ error: resolved.ambiguous ? "ambiguous remote session mapping" : "remote session mapping not found", ...resolved });
      return;
    }
    const cwd = body.cwd ?? resolved.exact.cwd;
    if (!cwd) {
      reply.code(400).send({ error: "resolved session has no cwd; pass cwd explicitly", resolved });
      return;
    }
    const resume = await state.enqueueResume(resolved.exact.client, { sessionId: resolved.exact.sessionId, cwd, name: body.name ?? resolved.exact.name ?? resolved.exact.title });
    return { resolved, resume };
  });

  app.post("/api/clients/:name/sessions/:sessionId/message", async (req) => {
    const { name, sessionId } = req.params as { name: string; sessionId: string };
    const body = (req.body ?? {}) as { text?: string };
    if (!body.text) throw new Error("text required");
    return state.enqueueMessage(name, { sessionId, text: body.text });
  });

  app.post("/api/clients/:name/sessions/:sessionId/interrupt", async (req) => {
    const { name, sessionId } = req.params as { name: string; sessionId: string };
    const body = (req.body ?? {}) as { text?: string; name?: string };
    return state.enqueueInterrupt(name, { sessionId, text: body.text, name: body.name });
  });

  app.post("/api/clients/:name/sessions/:sessionId/interrupt-and-message", async (req) => {
    const { name, sessionId } = req.params as { name: string; sessionId: string };
    const body = (req.body ?? {}) as { text?: string; name?: string };
    if (!body.text) throw new Error("text required");
    return state.enqueueInterrupt(name, { sessionId, text: body.text, name: body.name });
  });

  app.post("/api/clients/:name/sessions/:sessionId/stop", async (req) => {
    const { name, sessionId } = req.params as { name: string; sessionId: string };
    return state.enqueueStop(name, { sessionId });
  });

  app.delete("/api/clients/:name/sessions/:sessionId", async (req, reply) => {
    const { name, sessionId } = req.params as { name: string; sessionId: string };
    const deleted = state.deleteKnownSession(name, sessionId);
    if (!deleted) {
      reply.code(404).send({ error: `session ${sessionId} not found on client ${name}` });
      return;
    }
    return { deleted: true, sessionId };
  });

  app.delete("/api/clients/:name/sessions", async (req) => {
    const { name } = req.params as { name: string };
    const count = state.deleteAllKnownSessions(name);
    return { deleted: count, client: name };
  });

  app.delete("/api/clients/:name", async (req, reply) => {
    const { name } = req.params as { name: string };
    const force = (req.query as { force?: string | boolean }).force === true || (req.query as { force?: string }).force === "true";
    const result = state.deleteClient(name, { force });
    if (!result.deleted && result.online) {
      reply.code(409).send({ error: `client ${name} is online; disconnect it first or pass force=true`, online: true });
      return;
    }
    if (!result.deleted) {
      reply.code(404).send({ error: `unknown client: ${name}` });
      return;
    }
    return { deleted: true, client: name, wasOnline: result.online === true, forced: force };
  });

  app.post("/api/clients/:name/disconnect", async (req) => {
    const { name } = req.params as { name: string };
    return state.enqueueDisconnect(name);
  });

  app.post("/api/agent/connect", async (req) => {
    const body = (req.body ?? {}) as { name?: string; knownSessions?: unknown[]; reportedSessions?: unknown[] };
    if (!body.name) throw new Error("name required");
    return state.connectClient({ name: body.name, knownSessions: body.knownSessions, reportedSessions: body.reportedSessions });
  });

  app.post("/api/agent/sessions", async (req) => {
    const body = (req.body ?? {}) as { name?: string; sessions?: unknown[] };
    if (!body.name) throw new Error("name required");
    return state.reportSessions(body.name, body.sessions ?? []);
  });

  app.get("/api/agent/poll", async (req, reply) => {
    const name = (req.query as { name?: string }).name;
    if (!name) {
      reply.code(400).send({ error: "name required" });
      return;
    }
    const command = await state.takeNextCommand(name);
    if (!command) {
      reply.code(204).send();
      return;
    }
    return command;
  });

  app.post("/api/agent/ack", async (req) => {
    const body = (req.body ?? {}) as { id?: string; ok?: boolean; result?: unknown; error?: string };
    if (!body.id) throw new Error("id required");
    state.ackCommand(body.id, body);
    return { ok: true };
  });

  app.post("/api/agent/disconnect", async (req) => {
    const body = (req.body ?? {}) as { name?: string };
    if (!body.name) throw new Error("name required");
    state.disconnectClient(body.name);
    return { ok: true };
  });

  return app;
}

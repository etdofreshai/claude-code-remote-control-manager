import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { registerClaudeAiProxyRoutes } from "./claude-ai-proxy.js";
import { helpJson, helpMarkdown } from "./help.js";
import { RemoteControlState } from "./state.js";

export interface CreateAppOptions {
  state: RemoteControlState;
  token: string;
}

export function createApp({ state, token }: CreateAppOptions): FastifyInstance {
  if (!token) throw new Error("token required");
  const app = Fastify({ logger: process.env.LOG_LEVEL ? { level: process.env.LOG_LEVEL } : false });

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
      desiredSessions: client.desiredSessions,
      reportedSessions: client.reportedSessions,
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

  app.post("/api/clients/:name/sessions/:sessionId/message", async (req) => {
    const { name, sessionId } = req.params as { name: string; sessionId: string };
    const body = (req.body ?? {}) as { text?: string };
    if (!body.text) throw new Error("text required");
    return state.enqueueMessage(name, { sessionId, text: body.text });
  });

  app.post("/api/clients/:name/sessions/:sessionId/stop", async (req) => {
    const { name, sessionId } = req.params as { name: string; sessionId: string };
    return state.enqueueStop(name, { sessionId });
  });

  app.delete("/api/clients/:name/sessions/:sessionId", async (req, reply) => {
    const { name, sessionId } = req.params as { name: string; sessionId: string };
    const deleted = state.deleteReportedSession(name, sessionId);
    if (!deleted) {
      reply.code(404).send({ error: `session ${sessionId} not found on client ${name}` });
      return;
    }
    return { deleted: true, sessionId };
  });

  app.delete("/api/clients/:name/sessions", async (req) => {
    const { name } = req.params as { name: string };
    const count = state.deleteAllReportedSessions(name);
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
    const body = (req.body ?? {}) as { name?: string; reportedSessions?: unknown[] };
    if (!body.name) throw new Error("name required");
    return state.connectClient({ name: body.name, reportedSessions: body.reportedSessions });
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

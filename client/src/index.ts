import Fastify from "fastify";
import os from "node:os";
import { createSession, connectSession, listSessions } from "./sessions.js";

const CLIENT_TOKEN = process.env.CLIENT_TOKEN ?? "shared-token";
const PORT = Number(process.env.PORT ?? 4000);

const app = Fastify({ logger: true });

app.addHook("preHandler", async (req, reply) => {
  if (req.url === "/health") return;
  const auth = req.headers.authorization ?? "";
  const expected = `Bearer ${CLIENT_TOKEN}`;
  if (auth !== expected) {
    reply.code(401).send({ error: "unauthorized" });
  }
});

app.get("/health", async () => ({
  ok: true,
  hostname: os.hostname(),
  platform: process.platform,
}));

interface PromptBody {
  workingDirectory: string;
  prompt: string;
  sessionId?: string;
}

app.post("/session/create", async (req) => {
  const { workingDirectory, prompt } = req.body as PromptBody;
  if (!workingDirectory || !prompt) throw new Error("workingDirectory and prompt required");
  return createSession(workingDirectory, prompt);
});

app.post("/session/connect", async (req) => {
  const { sessionId, workingDirectory, prompt } = req.body as PromptBody;
  if (!sessionId || !workingDirectory || !prompt) {
    throw new Error("sessionId, workingDirectory and prompt required");
  }
  return connectSession(sessionId, workingDirectory, prompt);
});

app.post("/session/prompt", async (req) => {
  const body = req.body as PromptBody;
  if (body.sessionId) {
    return connectSession(body.sessionId, body.workingDirectory, body.prompt);
  }
  return createSession(body.workingDirectory, body.prompt);
});

app.get("/session/list", async () => listSessions());

app.listen({ host: "0.0.0.0", port: PORT }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});

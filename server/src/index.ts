import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyCookie from "@fastify/cookie";
import fastifyFormbody from "@fastify/formbody";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const UI_PASSWORD = process.env.UI_PASSWORD ?? "changeme";
const CLIENT_TOKEN = process.env.CLIENT_TOKEN ?? "shared-token";
const PORT = Number(process.env.PORT ?? 3000);
const SESSION_COOKIE = "ccrcm_session";
const SESSION_VALUE = Buffer.from(`${UI_PASSWORD}|ok`).toString("base64");
const POLL_TIMEOUT_MS = 25_000;
const ACK_TIMEOUT_MS = 60_000;
const AGENT_OFFLINE_AFTER_MS = 60_000;

interface TrackedSession {
  sessionId: string;
  workingDirectory: string;
  addedAt: string;
  lastMessageAt?: string;
  status?: string;
}

interface Agent {
  name: string;
  hostname?: string;
  platform?: string;
  registeredAt: string;
  lastSeenAt: string;
  sessions: TrackedSession[];
}

interface AgentCommand {
  id: string;
  type: "new" | "bind";
  payload: { workingDirectory: string; sessionId?: string };
}

const agents = new Map<string, Agent>();
const queues = new Map<string, AgentCommand[]>();
const waiters = new Map<string, Array<(cmd: AgentCommand | null) => void>>();
const acks = new Map<
  string,
  { resolve: (v: unknown) => void; reject: (e: unknown) => void; timer: NodeJS.Timeout }
>();

function touchAgent(name: string, info: Partial<Agent> = {}): Agent {
  const now = new Date().toISOString();
  const prev = agents.get(name);
  const a: Agent = {
    name,
    hostname: info.hostname ?? prev?.hostname,
    platform: info.platform ?? prev?.platform,
    registeredAt: prev?.registeredAt ?? now,
    lastSeenAt: now,
    sessions: info.sessions ?? prev?.sessions ?? [],
  };
  agents.set(name, a);
  return a;
}

function enqueue(name: string, cmd: AgentCommand): Promise<unknown> {
  const ackPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      acks.delete(cmd.id);
      reject(new Error("client did not acknowledge in time"));
    }, ACK_TIMEOUT_MS);
    acks.set(cmd.id, { resolve, reject, timer });
  });
  const list = waiters.get(name);
  if (list && list.length) {
    list.shift()!(cmd);
  } else {
    const q = queues.get(name) ?? [];
    q.push(cmd);
    queues.set(name, q);
  }
  return ackPromise;
}

function takeNext(name: string, timeoutMs: number): Promise<AgentCommand | null> {
  const q = queues.get(name);
  if (q && q.length) return Promise.resolve(q.shift()!);
  return new Promise((resolve) => {
    const list = waiters.get(name) ?? [];
    const cb = (cmd: AgentCommand | null) => {
      clearTimeout(timer);
      resolve(cmd);
    };
    list.push(cb);
    waiters.set(name, list);
    const timer = setTimeout(() => {
      const cur = waiters.get(name) ?? [];
      const idx = cur.indexOf(cb);
      if (idx >= 0) cur.splice(idx, 1);
      resolve(null);
    }, timeoutMs);
  });
}

const app = Fastify({ logger: true });
await app.register(fastifyCookie);
await app.register(fastifyFormbody);
await app.register(fastifyStatic, {
  root: path.join(__dirname, "..", "public"),
  prefix: "/static/",
});

const PUBLIC_DIR = path.join(__dirname, "..", "public");
const INDEX_HTML = readFileSync(path.join(PUBLIC_DIR, "index.html"), "utf8");

const isAuthed = (req: any) => req.cookies?.[SESSION_COOKIE] === SESSION_VALUE;
const isAgentReq = (req: any) => req.headers.authorization === `Bearer ${CLIENT_TOKEN}`;

app.addHook("preHandler", async (req, reply) => {
  const url = req.url;
  if (
    url === "/login" ||
    url.startsWith("/static/") ||
    url === "/api/login" ||
    url === "/healthz"
  ) {
    return;
  }
  if (url.startsWith("/api/agent/")) {
    if (!isAgentReq(req)) reply.code(401).send({ error: "unauthorized" });
    return;
  }
  if (url === "/" || url.startsWith("/api/")) {
    if (!isAuthed(req)) {
      if (url.startsWith("/api/")) reply.code(401).send({ error: "unauthorized" });
      else reply.redirect("/login");
    }
  }
});

app.get("/healthz", async () => ({ ok: true }));

app.get("/login", async (_req, reply) => {
  reply.type("text/html").send(`<!doctype html><html><head><meta charset="utf-8"><title>Login</title><link rel="stylesheet" href="/static/styles.css"></head><body class="login">
  <form method="post" action="/api/login" class="card">
    <h1>Claude Code Remote</h1>
    <input type="password" name="password" placeholder="Password" autofocus required>
    <button>Sign in</button>
  </form></body></html>`);
});

app.post("/api/login", async (req, reply) => {
  const body = (req.body ?? {}) as { password?: string };
  if (body.password !== UI_PASSWORD) {
    reply.code(401).type("text/html").send("Wrong password. <a href=/login>Try again</a>");
    return;
  }
  reply
    .setCookie(SESSION_COOKIE, SESSION_VALUE, { path: "/", httpOnly: true, sameSite: "lax" })
    .redirect("/");
});

app.post("/api/logout", async (_req, reply) => {
  reply.clearCookie(SESSION_COOKIE, { path: "/" }).send({ ok: true });
});

app.get("/", async (_req, reply) => reply.type("text/html").send(INDEX_HTML));

// --- UI endpoints ---
app.get("/api/clients", async () => {
  const now = Date.now();
  return [...agents.values()].map((a) => ({
    ...a,
    online: now - new Date(a.lastSeenAt).getTime() < AGENT_OFFLINE_AFTER_MS,
  }));
});

app.post("/api/clients/:name/sessions/new", async (req) => {
  const { name } = req.params as { name: string };
  if (!agents.has(name)) throw new Error(`unknown client: ${name}`);
  const { workingDirectory } = req.body as { workingDirectory: string };
  if (!workingDirectory) throw new Error("workingDirectory required");
  const cmd: AgentCommand = {
    id: randomUUID(),
    type: "new",
    payload: { workingDirectory },
  };
  return enqueue(name, cmd);
});

app.post("/api/clients/:name/sessions/bind", async (req) => {
  const { name } = req.params as { name: string };
  if (!agents.has(name)) throw new Error(`unknown client: ${name}`);
  const { workingDirectory, sessionId } = req.body as {
    workingDirectory: string;
    sessionId: string;
  };
  if (!workingDirectory || !sessionId)
    throw new Error("workingDirectory and sessionId required");
  const cmd: AgentCommand = {
    id: randomUUID(),
    type: "bind",
    payload: { workingDirectory, sessionId },
  };
  return enqueue(name, cmd);
});

// --- Agent endpoints ---
app.post("/api/agent/register", async (req) => {
  const body = req.body as Partial<Agent>;
  if (!body?.name) throw new Error("name required");
  return touchAgent(body.name, body);
});

app.post("/api/agent/sessions", async (req) => {
  const { name, sessions } = req.body as { name: string; sessions: TrackedSession[] };
  if (!name) throw new Error("name required");
  return touchAgent(name, { sessions: sessions ?? [] });
});

app.get("/api/agent/poll", async (req, reply) => {
  const name = (req.query as any)?.name as string | undefined;
  if (!name) {
    reply.code(400).send({ error: "name required" });
    return;
  }
  touchAgent(name);
  const cmd = await takeNext(name, POLL_TIMEOUT_MS);
  if (!cmd) {
    reply.code(204).send();
    return;
  }
  return cmd;
});

app.post("/api/agent/ack", async (req) => {
  const body = req.body as { id: string; error?: string; result?: unknown };
  const pending = acks.get(body.id);
  if (!pending) return { ok: false, reason: "not pending" };
  acks.delete(body.id);
  clearTimeout(pending.timer);
  if (body.error) pending.reject(new Error(body.error));
  else pending.resolve(body.result);
  return { ok: true };
});

app.listen({ host: "0.0.0.0", port: PORT }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});

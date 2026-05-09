import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyCookie from "@fastify/cookie";
import fastifyFormbody from "@fastify/formbody";
import path from "node:path";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
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

interface ProviderInfo {
  baseUrl?: string;
  authToken?: string;
  models: string[];
  modelOverrides?: Record<string, { baseUrl?: string; authToken?: string }>;
}

interface Agent {
  name: string;
  hostname?: string;
  platform?: string;
  defaultWorkingDirectory?: string;
  prefix?: string;
  providers?: Record<string, ProviderInfo>;
  defaultProvider?: string;
  defaultEffort?: string;
  registeredAt: string;
  lastSeenAt: string;
  sessions: TrackedSession[];
}

// --- prefix persistence (survives redeploys if /app/data is on a volume) ---
const PREFS_PATH = process.env.PREFS_PATH ?? "/app/data/prefs.json";
const prefixes = new Map<string, string>();

function loadPrefs(): void {
  try {
    if (!existsSync(PREFS_PATH)) return;
    const data = JSON.parse(readFileSync(PREFS_PATH, "utf8")) as Record<
      string,
      { prefix?: string }
    >;
    for (const [k, v] of Object.entries(data)) {
      if (v?.prefix !== undefined) prefixes.set(k, v.prefix);
    }
  } catch (err) {
    console.error("loadPrefs failed", err);
  }
}

function savePrefs(): void {
  try {
    mkdirSync(path.dirname(PREFS_PATH), { recursive: true });
    const out: Record<string, { prefix?: string }> = {};
    for (const [k, v] of prefixes.entries()) out[k] = { prefix: v };
    writeFileSync(PREFS_PATH, JSON.stringify(out, null, 2));
  } catch (err) {
    console.error("savePrefs failed", err);
  }
}

loadPrefs();

// --- agent state persistence (sessions cache, defaults, last-seen) ---
const AGENTS_PATH = process.env.AGENTS_PATH ?? "/app/data/agents.json";

function loadAgents(): void {
  try {
    if (!existsSync(AGENTS_PATH)) return;
    const data = JSON.parse(readFileSync(AGENTS_PATH, "utf8")) as Agent[];
    for (const a of data) {
      // Merge stored prefix from prefs file (authoritative).
      const merged: Agent = { ...a, prefix: prefixes.get(a.name) ?? a.prefix };
      agents.set(a.name, merged);
    }
    console.log(`loaded ${agents.size} agents from ${AGENTS_PATH}`);
  } catch (err) {
    console.error("loadAgents failed", err);
  }
}

let saveAgentsTimer: NodeJS.Timeout | null = null;
function saveAgents(): void {
  if (saveAgentsTimer) return;
  saveAgentsTimer = setTimeout(() => {
    saveAgentsTimer = null;
    try {
      mkdirSync(path.dirname(AGENTS_PATH), { recursive: true });
      writeFileSync(AGENTS_PATH, JSON.stringify([...agents.values()], null, 2));
    } catch (err) {
      console.error("saveAgents failed", err);
    }
  }, 500); // debounce: many writes happen close together
}

loadAgents();

interface AgentCommand {
  id: string;
  type: "new" | "bind" | "remove" | "rename" | "list" | "refresh";
  payload: {
    workingDirectory?: string;
    sessionId?: string;
    name?: string;
    provider?: string;
    model?: string;
    effort?: string;
    page?: number;
    pageSize?: number;
    query?: string;
  };
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
    defaultWorkingDirectory:
      info.defaultWorkingDirectory ?? prev?.defaultWorkingDirectory,
    prefix: prefixes.get(name) ?? prev?.prefix,
    providers: info.providers ?? prev?.providers,
    defaultProvider: info.defaultProvider ?? prev?.defaultProvider,
    defaultEffort: info.defaultEffort ?? prev?.defaultEffort,
    registeredAt: prev?.registeredAt ?? now,
    lastSeenAt: now,
    sessions: info.sessions ?? prev?.sessions ?? [],
  };
  agents.set(name, a);
  saveAgents();
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

const isAuthed = (req: any) => {
  if (req.cookies?.[SESSION_COOKIE] === SESSION_VALUE) return true;
  const auth = req.headers?.authorization;
  if (typeof auth === "string" && auth === `Bearer ${SESSION_VALUE}`) return true;
  return false;
};
const isAgentReq = (req: any) => req.headers.authorization === `Bearer ${CLIENT_TOKEN}`;

app.addHook("preHandler", async (req, reply) => {
  const url = req.url;
  if (
    url === "/" ||
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
  if (url.startsWith("/api/")) {
    if (!isAuthed(req)) reply.code(401).send({ error: "unauthorized" });
  }
});

app.get("/healthz", async () => ({ ok: true }));

app.get("/login", async (_req, reply) => {
  reply.type("text/html").send(`<!doctype html><html><head><meta charset="utf-8"><title>Login</title><link rel="stylesheet" href="/static/styles.css"></head><body class="login">
  <form id="login-form" class="card">
    <h1>Claude Code Remote</h1>
    <input type="password" name="password" placeholder="Password" autofocus required>
    <button>Sign in</button>
    <p id="login-error" style="color:#fc8181;display:none;margin:8px 0 0;font-size:12px;"></p>
  </form>
  <script>
    if (localStorage.getItem("ccrcm_token")) location.href = "/";
    document.getElementById("login-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const password = e.target.password.value;
      try {
        const res = await fetch("/api/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ password }),
        });
        if (!res.ok) throw new Error("Wrong password");
        const { token } = await res.json();
        localStorage.setItem("ccrcm_token", token);
        location.href = "/";
      } catch (err) {
        const el = document.getElementById("login-error");
        el.textContent = String(err.message || err);
        el.style.display = "block";
      }
    });
  </script>
  </body></html>`);
});

app.post("/api/login", async (req, reply) => {
  const body = (req.body ?? {}) as { password?: string };
  if (body.password !== UI_PASSWORD) {
    reply.code(401).send({ error: "wrong password" });
    return;
  }
  // Also set the cookie so server-rendered routes still work for legacy
  // clients, but the canonical mechanism is now Bearer + localStorage.
  reply
    .setCookie(SESSION_COOKIE, SESSION_VALUE, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30,
    })
    .send({ token: SESSION_VALUE });
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
  const {
    workingDirectory,
    name: sessionName,
    provider,
    model,
    effort,
  } = req.body as {
    workingDirectory: string;
    name?: string;
    provider?: string;
    model?: string;
    effort?: string;
  };
  if (!workingDirectory) throw new Error("workingDirectory required");
  const cmd: AgentCommand = {
    id: randomUUID(),
    type: "new",
    payload: { workingDirectory, name: sessionName, provider, model, effort },
  };
  return enqueue(name, cmd);
});

app.post("/api/clients/:name/sessions/bind", async (req) => {
  const { name } = req.params as { name: string };
  if (!agents.has(name)) throw new Error(`unknown client: ${name}`);
  const {
    workingDirectory,
    sessionId,
    name: sessionName,
    provider,
    model,
    effort,
  } = req.body as {
    workingDirectory: string;
    sessionId: string;
    name?: string;
    provider?: string;
    model?: string;
    effort?: string;
  };
  if (!workingDirectory || !sessionId)
    throw new Error("workingDirectory and sessionId required");
  const cmd: AgentCommand = {
    id: randomUUID(),
    type: "bind",
    payload: {
      workingDirectory,
      sessionId,
      name: sessionName,
      provider,
      model,
      effort,
    },
  };
  return enqueue(name, cmd);
});

app.post("/api/clients/:name/prefix", async (req) => {
  const { name } = req.params as { name: string };
  const agent = agents.get(name);
  if (!agent) throw new Error(`unknown client: ${name}`);
  // IMPORTANT: do NOT trim — user may want a trailing space after an emoji.
  const { prefix } = (req.body ?? {}) as { prefix?: string };
  const next = typeof prefix === "string" ? prefix : "";
  prefixes.set(name, next);
  savePrefs();
  agents.set(name, { ...agent, prefix: next });
  saveAgents();
  return { name, prefix: next };
});

app.post("/api/clients/:name/list", async (req) => {
  const { name } = req.params as { name: string };
  if (!agents.has(name)) throw new Error(`unknown client: ${name}`);
  const {
    workingDirectory,
    page = 0,
    pageSize = 20,
    query,
  } = (req.body ?? {}) as {
    workingDirectory?: string;
    page?: number;
    pageSize?: number;
    query?: string;
  };
  const cmd: AgentCommand = {
    id: randomUUID(),
    type: "list",
    payload: { workingDirectory, page, pageSize, query } as any,
  };
  return enqueue(name, cmd);
});

app.post("/api/clients/:name/sessions/:sessionId/rename", async (req) => {
  const { name, sessionId } = req.params as { name: string; sessionId: string };
  const agent = agents.get(name);
  if (!agent) throw new Error(`unknown client: ${name}`);
  const { name: newName, workingDirectory } = (req.body ?? {}) as {
    name?: string;
    workingDirectory?: string;
  };
  const cmd: AgentCommand = {
    id: randomUUID(),
    type: "rename",
    payload: {
      sessionId,
      name: newName?.trim() || undefined,
      workingDirectory,
    },
  };
  return enqueue(name, cmd);
});

app.post("/api/clients/:name/sessions/:sessionId/refresh", async (req) => {
  const { name, sessionId } = req.params as { name: string; sessionId: string };
  const agent = agents.get(name);
  if (!agent) throw new Error(`unknown client: ${name}`);
  const cmd: AgentCommand = {
    id: randomUUID(),
    type: "refresh",
    payload: { sessionId },
  };
  return enqueue(name, cmd);
});

app.delete("/api/clients/:name/sessions/:sessionId", async (req) => {
  const { name, sessionId } = req.params as { name: string; sessionId: string };
  const agent = agents.get(name);
  if (!agent) throw new Error(`unknown client: ${name}`);
  const before = agent.sessions.length;
  agent.sessions = agent.sessions.filter((s) => s.sessionId !== sessionId);
  agents.set(name, { ...agent, lastSeenAt: agent.lastSeenAt });
  saveAgents();
  const cmd: AgentCommand = {
    id: randomUUID(),
    type: "remove",
    payload: { sessionId },
  };
  enqueue(name, cmd).catch(() => {
    /* client may be offline; server-side cache is already updated */
  });
  return { removedFromServer: before !== agent.sessions.length, queued: true };
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

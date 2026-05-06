import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyCookie from "@fastify/cookie";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as registry from "./clients.js";
import type { ClientRecord, PromptRequest } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const UI_PASSWORD = process.env.UI_PASSWORD ?? "changeme";
const CLIENT_TOKEN = process.env.CLIENT_TOKEN ?? "shared-token";
const PORT = Number(process.env.PORT ?? 3000);
const SESSION_COOKIE = "ccrcm_session";
const SESSION_VALUE = Buffer.from(`${UI_PASSWORD}|ok`).toString("base64");

registry.loadFromEnv();

const app = Fastify({ logger: true });
await app.register(fastifyCookie);
await app.register(fastifyStatic, {
  root: path.join(__dirname, "..", "public"),
  prefix: "/static/",
});

function isAuthed(req: any): boolean {
  return req.cookies?.[SESSION_COOKIE] === SESSION_VALUE;
}

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
  if (url === "/" || url.startsWith("/api/")) {
    if (!isAuthed(req)) {
      if (url.startsWith("/api/")) {
        reply.code(401).send({ error: "unauthorized" });
      } else {
        reply.redirect("/login");
      }
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
  const password =
    body.password ??
    (typeof req.body === "string"
      ? new URLSearchParams(req.body).get("password") ?? undefined
      : undefined);
  if (password !== UI_PASSWORD) {
    reply.code(401).type("text/html").send("Wrong password. <a href=/login>Try again</a>");
    return;
  }
  reply
    .setCookie(SESSION_COOKIE, SESSION_VALUE, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
    })
    .redirect("/");
});

app.post("/api/logout", async (_req, reply) => {
  reply.clearCookie(SESSION_COOKIE, { path: "/" }).send({ ok: true });
});

app.get("/", async (_req, reply) => {
  reply.sendFile("index.html");
});

// --- Client registry ---
app.get("/api/clients", async () => registry.list());

app.post("/api/clients", async (req) => {
  const body = req.body as ClientRecord;
  if (!body?.name || !body?.baseUrl) {
    throw new Error("name and baseUrl required");
  }
  const c = registry.upsert({ name: body.name, baseUrl: body.baseUrl });
  return registry.probe(c, CLIENT_TOKEN);
});

app.delete("/api/clients/:name", async (req) => {
  const { name } = req.params as { name: string };
  return { removed: registry.remove(name) };
});

app.post("/api/clients/:name/probe", async (req) => {
  const { name } = req.params as { name: string };
  const c = registry.get(name);
  if (!c) throw new Error("not found");
  return registry.probe(c, CLIENT_TOKEN);
});

// --- Proxy to client ---
async function callClient(name: string, route: string, body: unknown) {
  const c = registry.get(name);
  if (!c) throw new Error(`unknown client: ${name}`);
  const res = await fetch(new URL(route, c.baseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${CLIENT_TOKEN}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`client ${name} ${res.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}

app.post("/api/clients/:name/prompt", async (req) => {
  const { name } = req.params as { name: string };
  const body = req.body as PromptRequest;
  const route = body.sessionId ? "/session/connect" : "/session/create";
  return callClient(name, route, body);
});

app.get("/api/clients/:name/sessions", async (req) => {
  const { name } = req.params as { name: string };
  const c = registry.get(name);
  if (!c) throw new Error(`unknown client: ${name}`);
  const res = await fetch(new URL("/session/list", c.baseUrl), {
    headers: { Authorization: `Bearer ${CLIENT_TOKEN}` },
  });
  if (!res.ok) throw new Error(`client ${name} ${res.status}`);
  return res.json();
});

app.listen({ host: "0.0.0.0", port: PORT }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});

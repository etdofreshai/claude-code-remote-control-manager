import os from "node:os";
import {
  startNew,
  bindExisting,
  removeSession,
  renameTracked,
  renameAny,
  listTracked,
  resumeAllTracked,
  shutdownAll,
  setChangeListener,
} from "./sessions.js";
import { listLocalSessions } from "./list.js";

const SERVER_URL = (process.env.SERVER_URL ?? "").replace(/\/+$/, "");
const CLIENT_TOKEN = process.env.CLIENT_TOKEN ?? "";
const AGENT_NAME = process.env.AGENT_NAME ?? os.hostname();
const DEFAULT_WORKING_DIRECTORY = process.env.DEFAULT_WORKING_DIRECTORY ?? "";

if (!SERVER_URL) throw new Error("SERVER_URL required");
if (!CLIENT_TOKEN) throw new Error("CLIENT_TOKEN required");

const headers = {
  "content-type": "application/json",
  Authorization: `Bearer ${CLIENT_TOKEN}`,
};

async function postJson(path: string, body: unknown) {
  const res = await fetch(`${SERVER_URL}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} ${res.status}: ${await res.text()}`);
  return res.headers.get("content-type")?.includes("json") ? res.json() : null;
}

async function reportSessions(): Promise<void> {
  try {
    await postJson("/api/agent/sessions", {
      name: AGENT_NAME,
      sessions: listTracked(),
    });
  } catch (err) {
    console.error("reportSessions failed", err);
  }
}

async function register(): Promise<void> {
  await postJson("/api/agent/register", {
    name: AGENT_NAME,
    hostname: os.hostname(),
    platform: process.platform,
    defaultWorkingDirectory: DEFAULT_WORKING_DIRECTORY || undefined,
    sessions: listTracked(),
  });
}

async function pollOnce(): Promise<void> {
  const url = `${SERVER_URL}/api/agent/poll?name=${encodeURIComponent(AGENT_NAME)}`;
  const res = await fetch(url, { headers });
  if (res.status === 204) return;
  if (!res.ok) throw new Error(`poll ${res.status}`);
  const cmd = (await res.json()) as {
    id: string;
    type: "new" | "bind" | "remove" | "rename" | "list";
    payload: {
      workingDirectory?: string;
      sessionId?: string;
      name?: string;
      page?: number;
      pageSize?: number;
      query?: string;
    };
  };
  console.log("received command", cmd.type, cmd.id);
  try {
    let result;
    if (cmd.type === "new") {
      if (!cmd.payload.workingDirectory) throw new Error("workingDirectory required");
      result = await startNew(cmd.payload.workingDirectory, cmd.payload.name);
    } else if (cmd.type === "bind") {
      if (!cmd.payload.sessionId || !cmd.payload.workingDirectory)
        throw new Error("sessionId and workingDirectory required for bind");
      result = await bindExisting(
        cmd.payload.sessionId,
        cmd.payload.workingDirectory,
        cmd.payload.name,
      );
    } else if (cmd.type === "remove") {
      if (!cmd.payload.sessionId) throw new Error("sessionId required for remove");
      result = await removeSession(cmd.payload.sessionId);
    } else if (cmd.type === "rename") {
      if (!cmd.payload.sessionId) throw new Error("sessionId required for rename");
      // Use renameAny which handles both tracked and untracked sessions.
      result = await renameAny(
        cmd.payload.sessionId,
        cmd.payload.name,
        cmd.payload.workingDirectory,
      );
    } else if (cmd.type === "list") {
      if (!cmd.payload.workingDirectory)
        throw new Error("workingDirectory required for list");
      result = listLocalSessions(
        cmd.payload.workingDirectory,
        cmd.payload.page ?? 0,
        cmd.payload.pageSize ?? 20,
        cmd.payload.query,
      );
    } else {
      throw new Error(`unknown command type: ${(cmd as any).type}`);
    }
    await postJson("/api/agent/ack", { id: cmd.id, result });
    await reportSessions();
  } catch (err) {
    console.error(`command ${cmd.id} failed`, err);
    await postJson("/api/agent/ack", { id: cmd.id, error: String(err) });
  }
}

async function pollLoop(): Promise<void> {
  while (true) {
    try {
      await pollOnce();
    } catch (err) {
      console.error("poll error", err);
      await new Promise((r) => setTimeout(r, 5_000));
    }
  }
}

async function main(): Promise<void> {
  setChangeListener(() => {
    reportSessions().catch(() => {});
  });

  console.log(`registering as ${AGENT_NAME} -> ${SERVER_URL}`);
  while (true) {
    try {
      await register();
      break;
    } catch (err) {
      console.error("register failed, retrying in 5s", err);
      await new Promise((r) => setTimeout(r, 5_000));
    }
  }

  console.log("resuming tracked sessions...");
  await resumeAllTracked();
  await reportSessions();

  setInterval(() => {
    register().catch((err) => console.error("re-register failed", err));
  }, 30_000);

  console.log("polling for commands...");
  await pollLoop();
}

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`received ${signal}, shutting down...`);
  try {
    await shutdownAll();
  } finally {
    process.exit(0);
  }
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import os from "node:os";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  startNew,
  bindExisting,
  removeSession,
  renameTracked,
  renameAny,
  refreshSession,
  switchSession,
  setSessionEnabled,
  sendMessage,
  type SendContentBlock,
  listTracked,
  resumeAllTracked,
  shutdownAll,
  setChangeListener,
  refreshLastMessageAtAll,
} from "./sessions.js";
import { listLocalSessions } from "./list.js";
import { publicProviders } from "./providers.js";
import { backfillFromDisk } from "./transcripts.js";
import type { Effort } from "./state.js";

const SERVER_URL = (process.env.SERVER_URL ?? "").replace(/\/+$/, "");
const CLIENT_TOKEN = process.env.CLIENT_TOKEN ?? "";
const AGENT_NAME = process.env.AGENT_NAME ?? os.hostname();
const DEFAULT_WORKING_DIRECTORY = process.env.DEFAULT_WORKING_DIRECTORY ?? "";

if (!SERVER_URL) throw new Error("SERVER_URL required");
if (!CLIENT_TOKEN) throw new Error("CLIENT_TOKEN required");

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadBuildInfo(): { sha: string; datetime: string } {
  try {
    const info = JSON.parse(
      readFileSync(path.join(__dirname, "version.json"), "utf8"),
    ) as { sha?: string; datetime?: string };
    return { sha: info.sha ?? "dev", datetime: info.datetime ?? "unknown" };
  } catch {
    return { sha: "dev", datetime: "unknown" };
  }
}
const BUILD_INFO = loadBuildInfo();
console.log(`ccrcm-client built sha=${BUILD_INFO.sha} datetime=${BUILD_INFO.datetime}`);

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
    refreshLastMessageAtAll();
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
    providers: publicProviders(),
    defaultProvider: process.env.DEFAULT_PROVIDER?.trim() || "claude",
    defaultEffort: (process.env.REASONING_EFFORT?.trim() || "low") as Effort,
    sessions: listTracked(),
    buildSha: BUILD_INFO.sha,
    buildDatetime: BUILD_INFO.datetime,
  });
}

async function pollOnce(): Promise<void> {
  const url = `${SERVER_URL}/api/agent/poll?name=${encodeURIComponent(AGENT_NAME)}`;
  const res = await fetch(url, { headers });
  if (res.status === 204) return;
  if (!res.ok) throw new Error(`poll ${res.status}`);
  const cmd = (await res.json()) as {
    id: string;
    type:
      | "new"
      | "bind"
      | "remove"
      | "rename"
      | "list"
      | "refresh"
      | "setEnabled"
      | "switch"
      | "message";
    payload: {
      workingDirectory?: string;
      sessionId?: string;
      name?: string;
      provider?: string;
      model?: string;
      effort?: Effort;
      runtime?: "cli" | "sdk";
      enabled?: boolean;
      content?: SendContentBlock[] | string;
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
      result = await startNew({
        workingDirectory: cmd.payload.workingDirectory,
        name: cmd.payload.name,
        provider: cmd.payload.provider,
        model: cmd.payload.model,
        effort: cmd.payload.effort,
        runtime: cmd.payload.runtime,
      });
    } else if (cmd.type === "bind") {
      if (!cmd.payload.sessionId || !cmd.payload.workingDirectory)
        throw new Error("sessionId and workingDirectory required for bind");
      result = await bindExisting({
        sessionId: cmd.payload.sessionId,
        workingDirectory: cmd.payload.workingDirectory,
        name: cmd.payload.name,
        provider: cmd.payload.provider,
        model: cmd.payload.model,
        effort: cmd.payload.effort,
        runtime: cmd.payload.runtime,
      });
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
    } else if (cmd.type === "refresh") {
      if (!cmd.payload.sessionId) throw new Error("sessionId required for refresh");
      result = await refreshSession(cmd.payload.sessionId);
    } else if (cmd.type === "setEnabled") {
      if (!cmd.payload.sessionId) throw new Error("sessionId required for setEnabled");
      if (typeof cmd.payload.enabled !== "boolean")
        throw new Error("enabled (boolean) required for setEnabled");
      result = await setSessionEnabled(cmd.payload.sessionId, cmd.payload.enabled);
    } else if (cmd.type === "message") {
      if (!cmd.payload.sessionId) throw new Error("sessionId required for message");
      if (cmd.payload.content == null) throw new Error("content required for message");
      result = await sendMessage(cmd.payload.sessionId, cmd.payload.content);
    } else if (cmd.type === "switch") {
      if (!cmd.payload.sessionId) throw new Error("sessionId required for switch");
      result = await switchSession(cmd.payload.sessionId, {
        provider: cmd.payload.provider,
        model: cmd.payload.model,
        effort: cmd.payload.effort,
      });
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

  // Backfill server-side transcripts from each tracked session's on-disk
  // history. resumeAllTracked() already triggers a backfill for sessions it
  // restarts, but disabled/stopped sessions are skipped — this loop covers
  // every tracked session so the UI has history for all of them on first load.
  for (const s of listTracked()) {
    backfillFromDisk(s.sessionId, s.workingDirectory);
  }

  setInterval(() => {
    register().catch((err) => console.error("re-register failed", err));
  }, 30_000);
  // Refresh last-activity timestamps from disk on a slower cadence.
  setInterval(() => {
    refreshLastMessageAtAll();
    reportSessions().catch(() => {});
  }, 15_000);

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

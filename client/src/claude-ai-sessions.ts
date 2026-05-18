import "dotenv/config";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

interface ClaudeCredentials {
  claudeAiOauth?: {
    accessToken?: string;
    expiresAt?: number | string;
  };
}

function parseFlags(argv: string[]) {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
    flags.set(arg.slice(2), value);
    i += 1;
  }
  return flags;
}

async function readClaudeAccessToken(credentialsPath: string): Promise<string> {
  const raw = await readFile(credentialsPath, "utf8");
  const parsed = JSON.parse(raw) as ClaudeCredentials;
  const token = parsed.claudeAiOauth?.accessToken;
  if (!token) throw new Error(`no claudeAiOauth.accessToken in ${credentialsPath}`);
  return token;
}

function compactSession(session: Record<string, unknown>) {
  return {
    updated_at: session.updated_at,
    connection_status: session.connection_status,
    id: session.id,
    title: session.title,
    tags: session.tags,
    branches: (session.external_metadata as { current_branches?: unknown } | undefined)?.current_branches,
  };
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const serverUrl = (flags.get("server") ?? process.env.CCRC_SERVER_URL ?? process.env.SERVER_URL ?? "").replace(/\/+$/, "");
  const ccrcToken = flags.get("token") ?? process.env.CCRC_TOKEN ?? process.env.REMOTE_TOKEN ?? process.env.CLIENT_TOKEN ?? "";
  const credentialsPath = flags.get("credentials") ?? process.env.CLAUDE_CREDENTIALS_PATH ?? path.join(homedir(), ".claude", ".credentials.json");
  const organizationUuid = flags.get("organization") ?? process.env.CLAUDE_AI_ORGANIZATION_UUID;
  const limit = Number(flags.get("limit") ?? process.env.LIMIT ?? "25");
  const activeOnly = flags.get("active") !== "false";

  if (!serverUrl) throw new Error("server URL required: pass --server or set CCRC_SERVER_URL");
  if (!ccrcToken) throw new Error("CCRC token required: pass --token or set CCRC_TOKEN");

  const accessToken = await readClaudeAccessToken(credentialsPath);
  const headers: Record<string, string> = {
    authorization: `Bearer ${ccrcToken}`,
    "x-claude-ai-authorization": `Bearer ${accessToken}`,
  };
  if (organizationUuid) headers["x-claude-ai-organization-uuid"] = organizationUuid;

  const res = await fetch(`${serverUrl}/api/claude-ai/sessions`, { headers });
  if (!res.ok) throw new Error(`live Claude.ai sessions failed ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { data?: Record<string, unknown>[] };
  const sessions = body.data ?? [];
  const filtered = activeOnly ? sessions.filter((session) => session.connection_status === "connected") : sessions;
  console.log(JSON.stringify(filtered.slice(0, limit).map(compactSession), null, 2));
  console.error(`shown=${Math.min(limit, filtered.length)} total=${filtered.length} activeOnly=${activeOnly}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

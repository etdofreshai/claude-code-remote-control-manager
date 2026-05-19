export interface ClientArgs {
  serverUrl: string;
  token: string;
  name: string;
}

export function parseArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): ClientArgs {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) throw new Error(`--${key} requires a value`);
    flags.set(key, value);
    i += 1;
  }
  const serverUrl = flags.get("server") ?? env.CCRC_SERVER_URL ?? env.SERVER_URL ?? "";
  const token = flags.get("token") ?? env.CCRCM_TOKEN ?? env.CCRC_TOKEN ?? env.REMOTE_TOKEN ?? env.CLIENT_TOKEN ?? "";
  const name = flags.get("name") ?? env.CCRC_NAME ?? env.AGENT_NAME ?? "";
  if (!serverUrl) throw new Error("server URL required: pass --server or set CCRC_SERVER_URL");
  if (!token) throw new Error("token required: pass --token or set CCRC_TOKEN");
  if (!name) throw new Error("client name required: pass --name or set CCRC_NAME");
  return { serverUrl, token, name };
}

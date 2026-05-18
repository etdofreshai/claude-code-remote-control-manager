#!/usr/bin/env node
import "dotenv/config";
import { parseArgs } from "./args.js";
import { ClaudeSdkController } from "./claude.js";
import { ClientRuntime } from "./runtime.js";
import { HttpServerApi } from "./server-api.js";

const args = parseArgs(process.argv.slice(2));
const server = new HttpServerApi({ serverUrl: args.serverUrl, token: args.token, name: args.name });
const claude = new ClaudeSdkController();
const runtime = new ClientRuntime({ name: args.name, server, claude });

let stopping = false;
async function stop(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.log(`received ${signal}; disabling remote control and disconnecting ${args.name}...`);
  try {
    await runtime.stop();
  } finally {
    process.exit(0);
  }
}

process.on("SIGINT", () => void stop("SIGINT"));
process.on("SIGTERM", () => void stop("SIGTERM"));

console.log(`connecting ${args.name} to ${args.serverUrl}`);
runtime.runUntilDisconnected().catch((err) => {
  console.error(err);
  process.exit(1);
});

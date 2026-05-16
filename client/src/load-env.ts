// Loads .env into process.env before anything else runs. Keep this file
// import-first so module hoisting guarantees env vars are populated before
// any other module evaluates its top-level `process.env.*` reads — that
// silently broke transcripts.ts in the past, where SERVER_URL/CLIENT_TOKEN
// ended up empty because they were captured before the .env was loaded.

import { existsSync } from "node:fs";
import path from "node:path";

for (const candidate of [".env", path.join("client", ".env")]) {
  if (existsSync(candidate)) {
    try {
      (process as any).loadEnvFile(candidate);
      break;
    } catch {
      // older Node versions / missing API — give up silently; tsx auto-load
      // may still cover us.
    }
  }
}

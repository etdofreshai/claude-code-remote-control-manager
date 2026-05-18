import path from "node:path";
import { createApp } from "./app.js";
import { RemoteControlState } from "./state.js";

const PORT = Number(process.env.PORT ?? 3000);
const TOKEN = process.env.REMOTE_TOKEN ?? process.env.CLIENT_TOKEN ?? "";
const STATE_FILE = process.env.STATE_FILE ?? path.join(process.cwd(), "data", "state.json");

if (!TOKEN) {
  console.error("REMOTE_TOKEN is required");
  process.exit(1);
}

const state = new RemoteControlState({ stateFile: STATE_FILE });
const app = createApp({ state, token: TOKEN });

app.listen({ host: "0.0.0.0", port: PORT }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});

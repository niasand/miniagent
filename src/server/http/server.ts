import { serve } from "@hono/node-server";
import { migrate, openDatabase } from "../db/migrate.js";
import { startProjectorLoop } from "../events/projector-runner.js";
import { createApp } from "./app.js";

const port = Number(process.env.MINIAGENT_API_PORT ?? 7273);
const db = openDatabase();
migrate(db);
startProjectorLoop(db, {
  onError: (error) => {
    console.error("Projector loop failed", error);
  },
});

serve({
  fetch: createApp(db).fetch,
  hostname: "127.0.0.1",
  port,
});

console.log(`MiniAgent API listening on http://127.0.0.1:${port}`);

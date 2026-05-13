import { serve } from "@hono/node-server";
import { migrate, openDatabase } from "../db/migrate.js";
import { createApp } from "./app.js";

const port = Number(process.env.MINIAGENT_API_PORT ?? 7273);
const db = openDatabase();
migrate(db);

serve({
  fetch: createApp(db).fetch,
  hostname: "127.0.0.1",
  port,
});

console.log(`MiniAgent API listening on http://127.0.0.1:${port}`);

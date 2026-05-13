import { Hono } from "hono";
import type { SqliteDatabase } from "../db/migrate.js";
import { EventStore } from "../events/event-store.js";
import { createWorkspaceSnapshot } from "../workspace/workspace-service.js";

export type AppBindings = {
  Variables: {
    db: SqliteDatabase;
  };
};

export function createApp(db: SqliteDatabase) {
  const app = new Hono<AppBindings>();

  app.use("*", async (context, next) => {
    context.set("db", db);
    await next();
  });

  app.get("/api/health", (context) =>
    context.json({
      ok: true,
      service: "miniagent",
    }),
  );

  app.get("/api/workspace", (context) => context.json(createWorkspaceSnapshot(context.get("db"))));

  app.get("/api/events", (context) => {
    const sessionId = context.req.query("sessionId") || undefined;
    const afterGlobalSeq = Number(context.req.query("afterGlobalSeq") ?? 0);
    const limit = Number(context.req.query("limit") ?? 100);

    if (!Number.isInteger(afterGlobalSeq) || afterGlobalSeq < 0) {
      return context.json({ error: "afterGlobalSeq must be a non-negative integer" }, 400);
    }
    if (!Number.isInteger(limit) || limit <= 0 || limit > 500) {
      return context.json({ error: "limit must be an integer between 1 and 500" }, 400);
    }

    const events = new EventStore(context.get("db")).listAfterGlobalSeq({
      sessionId,
      afterGlobalSeq,
      limit,
    });

    return context.json({ events });
  });

  return app;
}

import { Hono } from "hono";
import type { SqliteDatabase } from "../db/migrate.js";
import { EventStore } from "../events/event-store.js";
import { projectReadModelsUntilIdle } from "../events/projector-runner.js";
import { HandoffService } from "../handoff/handoff-service.js";
import type { AuditActorType } from "../audit/audit-log-store.js";
import { UserMessageService } from "../messages/user-message-service.js";
import type { AgentType } from "../runtime/types.js";
import { createWorkspaceSnapshot } from "../workspace/workspace-service.js";
import type { CreateHandoffResponse, SendMessageResponse } from "../../shared/workspace.js";

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

  app.get("/api/workspace", (context) =>
    context.json(
      createWorkspaceSnapshot(context.get("db"), {
        selectedSessionId: context.req.query("sessionId") || null,
      }),
    ),
  );

  app.post("/api/sessions/:sessionId/messages", async (context) => {
    const db = context.get("db");
    const body = await readJsonBody(context.req);
    if (!body.ok) {
      return context.json({ error: body.error }, 400);
    }

    const text = body.value.text;
    if (typeof text !== "string" || text.trim().length === 0) {
      return context.json({ error: "text is required" }, 400);
    }

    const actorRef = body.value.actorRef;
    if (actorRef !== undefined && actorRef !== null && typeof actorRef !== "string") {
      return context.json({ error: "actorRef must be a string or null" }, 400);
    }

    try {
      const result = new UserMessageService(db).send({
        sessionId: context.req.param("sessionId"),
        text,
        actorRef,
      });
      projectReadModelsUntilIdle(db);

      const response: SendMessageResponse = {
        taskId: result.task.id,
        eventId: result.event.id,
        workspace: createWorkspaceSnapshot(db, { selectedSessionId: context.req.param("sessionId") }),
      };

      return context.json(response, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Message send failed";
      if (message.startsWith("Session not found")) {
        return context.json({ error: message }, 404);
      }
      if (message.includes("archived") || message.includes("required")) {
        return context.json({ error: message }, 400);
      }
      return context.json({ error: message }, 500);
    }
  });

  app.post("/api/sessions/:sessionId/handoffs", async (context) => {
    const db = context.get("db");
    const body = await readJsonBody(context.req);
    if (!body.ok) {
      return context.json({ error: body.error }, 400);
    }

    const targetAgentType = body.value.targetAgentType;
    if (!isAgentType(targetAgentType)) {
      return context.json({ error: "targetAgentType must be one of: codex, claude, trae" }, 400);
    }

    const actorType = body.value.actorType ?? "web_user";
    if (!isAuditActorType(actorType)) {
      return context.json({ error: "actorType must be one of: web_user, feishu_user, system, agent" }, 400);
    }

    const actorRef = body.value.actorRef;
    if (actorRef !== undefined && actorRef !== null && typeof actorRef !== "string") {
      return context.json({ error: "actorRef must be a string or null" }, 400);
    }

    const targetTitle = body.value.targetTitle;
    if (targetTitle !== undefined && typeof targetTitle !== "string") {
      return context.json({ error: "targetTitle must be a string" }, 400);
    }

    try {
      const result = new HandoffService(db).handoff({
        sourceSessionId: context.req.param("sessionId"),
        targetAgentType,
        actorType,
        actorRef,
        targetTitle,
      });
      projectReadModelsUntilIdle(db);

      const response: CreateHandoffResponse = {
        targetSessionId: result.targetSession.id,
        targetTaskId: result.task.id,
        sourceContextPackId: result.contextPack.id,
        requestedEventId: result.requestedEvent.id,
        createdEventId: result.createdEvent.id,
        workspace: createWorkspaceSnapshot(db, { selectedSessionId: result.targetSession.id }),
      };

      return context.json(response, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Handoff failed";
      if (message.startsWith("Session not found")) {
        return context.json({ error: message }, 404);
      }
      if (message.includes("target agent")) {
        return context.json({ error: message }, 400);
      }
      return context.json({ error: message }, 500);
    }
  });

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

async function readJsonBody(request: { json: () => Promise<unknown> }): Promise<
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string }
> {
  try {
    const value = await request.json();
    if (!isRecord(value)) {
      return { ok: false, error: "Request body must be a JSON object" };
    }
    return { ok: true, value };
  } catch {
    return { ok: false, error: "Request body must be valid JSON" };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAgentType(value: unknown): value is AgentType {
  return value === "codex" || value === "claude" || value === "trae";
}

function isAuditActorType(value: unknown): value is AuditActorType {
  return value === "web_user" || value === "feishu_user" || value === "system" || value === "agent";
}

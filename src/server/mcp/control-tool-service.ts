import { ContextBudgetService } from "../context/context-budget-service.js";
import type { SqliteDatabase } from "../db/migrate.js";
import { EventStore } from "../events/event-store.js";
import { SchedulerService } from "../scheduler/scheduler-service.js";
import type { ScheduleRecord } from "../scheduler/schedule-store.js";
import { SessionStore } from "../sessions/session-store.js";
import { createWorkspaceSnapshot } from "../workspace/workspace-service.js";
import type { AuditActorType } from "../audit/audit-log-store.js";
import type { JsonObject } from "../../shared/json.js";

export type ControlToolDescriptor = {
  name: string;
  description: string;
  inputSchema: JsonObject;
};

export type ControlToolCallResult = {
  name: string;
  result: unknown;
};

type OutboxStatusRow = {
  id: string;
  session_id: string;
  event_global_seq: number | null;
  channel_type: string;
  target_ref: string;
  kind: string;
  status: string;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string | null;
  locked_by: string | null;
  lease_expires_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

const TOOL_DESCRIPTORS: ControlToolDescriptor[] = [
  {
    name: "session.list",
    description: "List sessions visible in the MiniAgent workspace.",
    inputSchema: objectSchema({}),
  },
  {
    name: "session.status",
    description: "Read one session, its active run, and next queued task.",
    inputSchema: objectSchema({ sessionId: { type: "string" } }, ["sessionId"]),
  },
  {
    name: "events.query",
    description: "Query EventStore records after a global_seq replay cursor.",
    inputSchema: objectSchema({
      sessionId: { type: "string" },
      afterGlobalSeq: { type: "integer", minimum: 0 },
      limit: { type: "integer", minimum: 1, maximum: 200 },
    }),
  },
  {
    name: "outbox.status",
    description: "List recent Outbox delivery records and retry state.",
    inputSchema: objectSchema({
      sessionId: { type: "string" },
      limit: { type: "integer", minimum: 1, maximum: 200 },
    }),
  },
  {
    name: "context.status",
    description: "Evaluate context budget without triggering auto-compact.",
    inputSchema: objectSchema({ sessionId: { type: "string" } }, ["sessionId"]),
  },
  {
    name: "context.compact",
    description: "Create a ContextPack for a session.",
    inputSchema: objectSchema({ sessionId: { type: "string" } }, ["sessionId"]),
  },
  {
    name: "schedule.create",
    description: "Create a one-shot or cron schedule.",
    inputSchema: objectSchema(
      {
        sessionId: { type: "string" },
        kind: { enum: ["once", "cron"] },
        runAt: { type: "string" },
        cronExpr: { type: "string" },
        timezone: { type: "string" },
        payload: { type: "object" },
      },
      ["sessionId", "kind"],
    ),
  },
  {
    name: "schedule.pause",
    description: "Pause a schedule.",
    inputSchema: objectSchema({ scheduleId: { type: "string" } }, ["scheduleId"]),
  },
  {
    name: "schedule.resume",
    description: "Resume a schedule.",
    inputSchema: objectSchema({ scheduleId: { type: "string" } }, ["scheduleId"]),
  },
  {
    name: "schedule.cancel",
    description: "Cancel a schedule.",
    inputSchema: objectSchema({ scheduleId: { type: "string" } }, ["scheduleId"]),
  },
];

export class ControlToolService {
  constructor(private readonly db: SqliteDatabase) {}

  listTools(): ControlToolDescriptor[] {
    return TOOL_DESCRIPTORS;
  }

  callTool(name: string, args: JsonObject = {}): ControlToolCallResult {
    switch (name) {
      case "session.list":
        return { name, result: createWorkspaceSnapshot(this.db).sessions };
      case "session.status":
        return { name, result: this.sessionStatus(args) };
      case "events.query":
        return { name, result: this.queryEvents(args) };
      case "outbox.status":
        return { name, result: this.outboxStatus(args) };
      case "context.status":
        return { name, result: this.contextStatus(args) };
      case "context.compact":
        return { name, result: this.contextCompact(args) };
      case "schedule.create":
        return { name, result: this.scheduleCreate(args) };
      case "schedule.pause":
        return { name, result: this.scheduleStatus(args, "pause") };
      case "schedule.resume":
        return { name, result: this.scheduleStatus(args, "resume") };
      case "schedule.cancel":
        return { name, result: this.scheduleStatus(args, "cancel") };
      default:
        throw new Error(`Unknown control tool: ${name}`);
    }
  }

  private sessionStatus(args: JsonObject): unknown {
    const sessions = new SessionStore(this.db, new EventStore(this.db));
    const sessionId = readString(args, "sessionId");
    const session = sessions.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    return {
      session,
      activeRun: session.activeRunId ? sessions.getRun(session.activeRunId) : null,
      nextQueuedTask: sessions.getNextQueuedTask(session.id),
    };
  }

  private queryEvents(args: JsonObject): unknown {
    return new EventStore(this.db).listAfterGlobalSeq({
      sessionId: readOptionalString(args, "sessionId") ?? undefined,
      afterGlobalSeq: readNonNegativeInteger(args, "afterGlobalSeq", 0),
      limit: readLimit(args, 100),
    });
  }

  private outboxStatus(args: JsonObject): unknown {
    const sessionId = readOptionalString(args, "sessionId");
    const rows = this.db
      .prepare(
        `
        SELECT
          id, session_id, event_global_seq, channel_type, target_ref, kind, status,
          attempts, max_attempts, next_attempt_at, locked_by, lease_expires_at,
          last_error, created_at, updated_at
        FROM outbox
        WHERE (@sessionId IS NULL OR session_id = @sessionId)
        ORDER BY created_at DESC, id DESC
        LIMIT @limit
      `,
      )
      .all({ sessionId: sessionId ?? null, limit: readLimit(args, 50) }) as OutboxStatusRow[];

    return rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      eventGlobalSeq: row.event_global_seq,
      channelType: row.channel_type,
      targetRef: row.target_ref,
      kind: row.kind,
      status: row.status,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      nextAttemptAt: row.next_attempt_at,
      lockedBy: row.locked_by,
      leaseExpiresAt: row.lease_expires_at,
      lastError: row.last_error,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  private contextStatus(args: JsonObject): unknown {
    return new ContextBudgetService(this.db).evaluate({
      sessionId: readString(args, "sessionId"),
      autoCompact: false,
    }).budget;
  }

  private contextCompact(args: JsonObject): unknown {
    const result = new ContextBudgetService(this.db).compactNow({
      sessionId: readString(args, "sessionId"),
      createdBy: "agent",
    });
    return {
      contextPack: result.contextPack,
      budget: result.budget,
    };
  }

  private scheduleCreate(args: JsonObject): ScheduleRecord {
    return new SchedulerService(this.db).createSchedule({
      sessionId: readString(args, "sessionId"),
      kind: readScheduleKind(args),
      runAt: readOptionalString(args, "runAt"),
      cronExpr: readOptionalString(args, "cronExpr"),
      timezone: readOptionalString(args, "timezone") ?? "Asia/Shanghai",
      payload: readOptionalObject(args, "payload") ?? {},
      actorType: readActorType(args),
      actorRef: readOptionalString(args, "actorRef"),
    });
  }

  private scheduleStatus(args: JsonObject, action: "pause" | "resume" | "cancel"): ScheduleRecord {
    const service = new SchedulerService(this.db);
    const scheduleId = readString(args, "scheduleId");
    const actorType = readActorType(args);
    const actorRef = readOptionalString(args, "actorRef");
    if (action === "pause") {
      return service.pauseSchedule(scheduleId, actorType, actorRef);
    }
    if (action === "resume") {
      return service.resumeSchedule(scheduleId, actorType, actorRef);
    }
    return service.cancelSchedule(scheduleId, actorType, actorRef);
  }
}

function readString(args: JsonObject, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${key} is required`);
  }
  return value.trim();
}

function readOptionalString(args: JsonObject, key: string): string | null {
  const value = args[key];
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`${key} must be a string`);
  }
  return value.trim();
}

function readOptionalObject(args: JsonObject, key: string): JsonObject | null {
  const value = args[key];
  if (value === undefined || value === null) {
    return null;
  }
  if (!isJsonObject(value)) {
    throw new Error(`${key} must be a JSON object`);
  }
  return value;
}

function readNonNegativeInteger(args: JsonObject, key: string, fallback: number): number {
  const value = args[key] ?? fallback;
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new Error(`${key} must be a non-negative integer`);
  }
  return Number(value);
}

function readLimit(args: JsonObject, fallback: number): number {
  const value = args.limit ?? fallback;
  if (!Number.isInteger(value) || Number(value) <= 0 || Number(value) > 200) {
    throw new Error("limit must be an integer between 1 and 200");
  }
  return Number(value);
}

function readActorType(args: JsonObject): AuditActorType {
  const value = args.actorType ?? "agent";
  if (value === "web_user" || value === "feishu_user" || value === "system" || value === "agent") {
    return value;
  }
  throw new Error("actorType must be one of: web_user, feishu_user, system, agent");
}

function readScheduleKind(args: JsonObject): "once" | "cron" {
  const kind = args.kind;
  if (kind === "once" || kind === "cron") {
    return kind;
  }
  throw new Error("kind must be once or cron");
}

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function objectSchema(properties: JsonObject, required: string[] = []): JsonObject {
  return {
    type: "object",
    additionalProperties: false,
    properties,
    required,
  };
}

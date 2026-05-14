import { Hono, type Context } from "hono";
import type { SqliteDatabase } from "../db/migrate.js";
import { ContextBudgetService } from "../context/context-budget-service.js";
import { FeishuInboundService } from "../channels/feishu-inbound-service.js";
import { EventStore } from "../events/event-store.js";
import { projectReadModelsUntilIdle } from "../events/projector-runner.js";
import { HandoffService } from "../handoff/handoff-service.js";
import { AuditLogStore, type AuditActorType } from "../audit/audit-log-store.js";
import { DefaultAgentService } from "../agents/default-agent-service.js";
import type { AgentDefaultRecord, AgentDefaultScopeType } from "../agents/agent-default-store.js";
import { MemoryArchiveService } from "../memory/memory-archive-service.js";
import type { MemoryArchiveRecord } from "../memory/memory-archive-store.js";
import { UserMessageService } from "../messages/user-message-service.js";
import type { AgentType } from "../runtime/types.js";
import { RuntimeAdapterRegistry } from "../runtime/registry.js";
import type { RuntimeProcessFactory } from "../runtime/process.js";
import { RuntimeService } from "../runtime/runtime-service.js";
import { RuntimeSupervisor } from "../runtime/runtime-supervisor.js";
import { SchedulerService } from "../scheduler/scheduler-service.js";
import type { ScheduleRecord } from "../scheduler/schedule-store.js";
import { SessionStore } from "../sessions/session-store.js";
import { createWorkspaceSnapshot } from "../workspace/workspace-service.js";
import type { JsonObject } from "../../shared/json.js";
import type {
  AgentsResponse,
  AgentDefault,
  CompactContextResponse,
  CreateHandoffResponse,
  CreateMemoryArchiveResponse,
  CreateScheduleResponse,
  CreateSessionResponse,
  ListSchedulesResponse,
  ListMemoryArchivesResponse,
  RunDueSchedulesResponse,
  SendMessageResponse,
  ResolveAgentDefaultResponse,
  SetAgentDefaultResponse,
  StartRunResponse,
  UpdateScheduleResponse,
  WorkspaceSchedule,
  MemoryArchive,
} from "../../shared/workspace.js";

export type AppBindings = {
  Variables: {
    db: SqliteDatabase;
  };
};

export type AppOptions = {
  runtimeRegistry?: RuntimeAdapterRegistry;
  processFactory?: RuntimeProcessFactory;
  defaultWorkspacePath?: string;
};

export function createApp(db: SqliteDatabase, options: AppOptions = {}) {
  const app = new Hono<AppBindings>();
  const runtimeRegistry = options.runtimeRegistry ?? new RuntimeAdapterRegistry();
  const defaultWorkspacePath = options.defaultWorkspacePath ?? process.cwd();
  const eventStore = new EventStore(db);
  const sessionStore = new SessionStore(db, eventStore);
  const runtimeSupervisor = new RuntimeSupervisor({
    adapterRegistry: runtimeRegistry,
    eventStore,
    sessionStore,
    processFactory: options.processFactory,
  });
  const runtimeService = new RuntimeService(db, runtimeSupervisor);

  app.use("*", async (context, next) => {
    context.set("db", db);
    await next();
  });

  app.get("/", (context) =>
    context.json({
      ok: true,
      service: "miniagent",
      ui: "http://127.0.0.1:7272/",
      endpoints: [
        "/api/health",
        "/api/workspace",
        "/api/agents",
        "/api/agent-defaults",
        "/api/sessions",
        "/api/events",
        "/api/events/stream",
        "/api/sessions/:sessionId/context/compact",
        "/api/schedules",
        "/api/schedules/due/run",
        "/api/feishu/messages",
        "/api/sessions/:sessionId/memory/archives",
      ],
    }),
  );

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

  app.get("/api/agents", async (context) => {
    const agents = await Promise.all(
      runtimeRegistry.list().map(async (adapter) => {
        const probe = await adapter.probe();
        return {
          agentType: adapter.agentType,
          label: adapter.displayName,
          status: probe.status,
          command: probe.command,
          version: probe.version,
          message: probe.message,
          checkedAt: probe.checkedAt,
          capabilities: adapter.capabilities(),
        };
      }),
    );
    const response: AgentsResponse = { agents };

    return context.json(response);
  });

  app.get("/api/agent-defaults/resolve", (context) => {
    try {
      const resolved = new DefaultAgentService(context.get("db")).resolve({
        userRef: context.req.query("userRef") ?? null,
        channelRef: context.req.query("channelRef") ?? null,
        workspacePath: context.req.query("workspacePath") ?? null,
      });
      const response: ResolveAgentDefaultResponse = { default: mapAgentDefault(resolved) };
      return context.json(response);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Resolve default agent failed";
      return context.json({ error: message }, 500);
    }
  });

  app.post("/api/agent-defaults", async (context) => {
    const body = await readJsonBody(context.req);
    if (!body.ok) {
      return context.json({ error: body.error }, 400);
    }

    const scopeType = body.value.scopeType;
    if (!isAgentDefaultScopeType(scopeType)) {
      return context.json({ error: "scopeType must be one of: user, channel, workspace, system" }, 400);
    }

    const scopeRef = body.value.scopeRef;
    if (typeof scopeRef !== "string" || scopeRef.trim().length === 0) {
      return context.json({ error: "scopeRef is required" }, 400);
    }

    const agentType = body.value.agentType;
    if (!isAgentType(agentType)) {
      return context.json({ error: "agentType must be one of: codex, claude, trae" }, 400);
    }

    const params = body.value.params;
    if (params !== undefined && !isJsonRecord(params)) {
      return context.json({ error: "params must be a JSON object" }, 400);
    }

    try {
      const saved = new DefaultAgentService(context.get("db")).setDefault({
        scopeType,
        scopeRef,
        agentType,
        params: params ? (params as JsonObject) : {},
      });
      const response: SetAgentDefaultResponse = { default: mapAgentDefault(saved) };
      return context.json(response, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Set default agent failed";
      if (message.includes("scopeRef")) {
        return context.json({ error: message }, 400);
      }
      return context.json({ error: message }, 500);
    }
  });

  app.post("/api/sessions", async (context) => {
    const db = context.get("db");
    const body = await readJsonBody(context.req);
    if (!body.ok) {
      return context.json({ error: body.error }, 400);
    }

    const requestedAgentType = body.value.agentType;
    if (requestedAgentType !== undefined && !isAgentType(requestedAgentType)) {
      return context.json({ error: "agentType must be one of: codex, claude, trae" }, 400);
    }

    const title = body.value.title;
    if (title !== undefined && typeof title !== "string") {
      return context.json({ error: "title must be a string" }, 400);
    }

    const workspacePath = body.value.workspacePath;
    if (workspacePath !== undefined && typeof workspacePath !== "string") {
      return context.json({ error: "workspacePath must be a string" }, 400);
    }

    const effectiveWorkspacePath = workspacePath?.trim() || defaultWorkspacePath;
    const agentType =
      requestedAgentType ??
      new DefaultAgentService(db).resolve({
        workspacePath: effectiveWorkspacePath,
      }).agentType;
    const session = new SessionStore(db).createSession({
      title: title?.trim() || `${displayAgent(agentType)} session`,
      agentType,
      workspacePath: effectiveWorkspacePath,
      channelType: "web",
    });
    const response: CreateSessionResponse = {
      sessionId: session.id,
      workspace: createWorkspaceSnapshot(db, { selectedSessionId: session.id }),
    };

    return context.json(response, 201);
  });

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
      new ContextBudgetService(db).evaluate({ sessionId: context.req.param("sessionId") });
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
      const contextBudget = new ContextBudgetService(db);
      contextBudget.evaluate({ sessionId: context.req.param("sessionId") });
      contextBudget.evaluate({ sessionId: result.targetSession.id, autoCompact: false });
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

  app.post("/api/sessions/:sessionId/runs/start", (context) => {
    const db = context.get("db");

    try {
      const result = runtimeService.startNextQueuedTask(context.req.param("sessionId"));
      new ContextBudgetService(db).evaluate({ sessionId: context.req.param("sessionId") });
      projectReadModelsUntilIdle(db);

      const response: StartRunResponse = {
        taskId: result.task.id,
        runId: result.run.id,
        status: result.run.status,
        workspace: createWorkspaceSnapshot(db, { selectedSessionId: context.req.param("sessionId") }),
      };

      return context.json(response, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Runtime start failed";
      if (message.startsWith("Session not found")) {
        return context.json({ error: message }, 404);
      }
      if (message.includes("No queued task") || message.includes("active run")) {
        return context.json({ error: message }, 409);
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

  app.get("/api/events/stream", (context) => {
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
    const body =
      events
        .map(
          (event) =>
            `id: ${event.globalSeq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
        )
        .join("") + ": cursor-ready\n\n";

    return new Response(body, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  });

  app.get("/api/schedules", (context) => {
    const sessionId = context.req.query("sessionId");
    if (!sessionId) {
      return context.json({ error: "sessionId is required" }, 400);
    }

    try {
      const schedules = new SchedulerService(context.get("db")).listSchedules(sessionId).map(mapSchedule);
      const response: ListSchedulesResponse = { schedules };
      return context.json(response);
    } catch (error) {
      const message = error instanceof Error ? error.message : "List schedules failed";
      if (message.startsWith("Session not found")) {
        return context.json({ error: message }, 404);
      }
      return context.json({ error: message }, 500);
    }
  });

  app.post("/api/schedules", async (context) => {
    const db = context.get("db");
    const body = await readJsonBody(context.req);
    if (!body.ok) {
      return context.json({ error: body.error }, 400);
    }

    const sessionId = body.value.sessionId;
    if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
      return context.json({ error: "sessionId is required" }, 400);
    }

    const kind = body.value.kind;
    if (kind !== "once" && kind !== "cron") {
      return context.json({ error: "kind must be once or cron" }, 400);
    }

    const cronExpr = body.value.cronExpr;
    if (cronExpr !== undefined && cronExpr !== null && typeof cronExpr !== "string") {
      return context.json({ error: "cronExpr must be a string or null" }, 400);
    }

    const runAt = body.value.runAt;
    if (runAt !== undefined && runAt !== null && typeof runAt !== "string") {
      return context.json({ error: "runAt must be a string or null" }, 400);
    }

    const timezone = body.value.timezone;
    if (timezone !== undefined && typeof timezone !== "string") {
      return context.json({ error: "timezone must be a string" }, 400);
    }

    const payload = body.value.payload;
    if (payload !== undefined && !isJsonRecord(payload)) {
      return context.json({ error: "payload must be a JSON object" }, 400);
    }

    const actorType = body.value.actorType ?? "web_user";
    if (!isAuditActorType(actorType)) {
      return context.json({ error: "actorType must be one of: web_user, feishu_user, system, agent" }, 400);
    }

    const actorRef = body.value.actorRef;
    if (actorRef !== undefined && actorRef !== null && typeof actorRef !== "string") {
      return context.json({ error: "actorRef must be a string or null" }, 400);
    }

    try {
      const schedule = new SchedulerService(db).createSchedule({
        sessionId: sessionId.trim(),
        kind,
        cronExpr: typeof cronExpr === "string" ? cronExpr : null,
        runAt: typeof runAt === "string" ? runAt : null,
        timezone: typeof timezone === "string" ? timezone : undefined,
        payload: payload ? (payload as JsonObject) : {},
        actorType,
        actorRef: typeof actorRef === "string" ? actorRef : null,
      });
      const response: CreateScheduleResponse = { schedule: mapSchedule(schedule) };
      return context.json(response, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Create schedule failed";
      if (message.startsWith("Session not found")) {
        return context.json({ error: message }, 404);
      }
      if (message.includes("required") || message.includes("cron") || message.includes("timestamp")) {
        return context.json({ error: message }, 400);
      }
      return context.json({ error: message }, 500);
    }
  });

  app.post("/api/schedules/due/run", async (context) => {
    const db = context.get("db");
    const body = await readOptionalJsonBody(context.req);
    if (!body.ok) {
      return context.json({ error: body.error }, 400);
    }

    const workerId = body.value.workerId;
    if (workerId !== undefined && typeof workerId !== "string") {
      return context.json({ error: "workerId must be a string" }, 400);
    }

    const now = body.value.now;
    if (now !== undefined && typeof now !== "string") {
      return context.json({ error: "now must be a string" }, 400);
    }

    const limit = body.value.limit;
    if (limit !== undefined && (typeof limit !== "number" || !Number.isInteger(limit) || limit <= 0)) {
      return context.json({ error: "limit must be a positive integer" }, 400);
    }

    try {
      const service = new SchedulerService(db);
      const triggered = service.runDueSchedules({
        workerId: typeof workerId === "string" ? workerId : "api",
        now: typeof now === "string" ? now : undefined,
        limit: typeof limit === "number" ? limit : undefined,
      });
      projectReadModelsUntilIdle(db);

      const firstSessionId = triggered[0]?.schedule.sessionId ?? null;
      const response: RunDueSchedulesResponse = {
        triggered: triggered.map((item) => ({
          schedule: mapSchedule(item.schedule),
          taskId: item.task.id,
        })),
        workspace: createWorkspaceSnapshot(db, { selectedSessionId: firstSessionId }),
      };
      return context.json(response);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Run due schedules failed";
      if (message.includes("lease") || message.includes("cron") || message.includes("limit") || message.includes("timestamp")) {
        return context.json({ error: message }, 400);
      }
      return context.json({ error: message }, 500);
    }
  });

  app.post("/api/schedules/:scheduleId/pause", (context) =>
    updateScheduleStatus(context, "pause", (service, scheduleId, actorType, actorRef) =>
      service.pauseSchedule(scheduleId, actorType, actorRef),
    ),
  );

  app.post("/api/schedules/:scheduleId/resume", (context) =>
    updateScheduleStatus(context, "resume", (service, scheduleId, actorType, actorRef) =>
      service.resumeSchedule(scheduleId, actorType, actorRef),
    ),
  );

  app.post("/api/schedules/:scheduleId/cancel", (context) =>
    updateScheduleStatus(context, "cancel", (service, scheduleId, actorType, actorRef) =>
      service.cancelSchedule(scheduleId, actorType, actorRef),
    ),
  );

  app.post("/api/feishu/messages", async (context) => {
    const db = context.get("db");
    const body = await readJsonBody(context.req);
    if (!body.ok) {
      return context.json({ error: body.error }, 400);
    }

    const messageId = body.value.messageId;
    if (typeof messageId !== "string" || messageId.trim().length === 0) {
      return context.json({ error: "messageId is required" }, 400);
    }

    const chatId = body.value.chatId;
    if (typeof chatId !== "string" || chatId.trim().length === 0) {
      return context.json({ error: "chatId is required" }, 400);
    }

    const text = body.value.text;
    if (typeof text !== "string" || text.trim().length === 0) {
      return context.json({ error: "text is required" }, 400);
    }

    const userId = body.value.userId;
    if (userId !== undefined && userId !== null && typeof userId !== "string") {
      return context.json({ error: "userId must be a string or null" }, 400);
    }

    const sessionId = body.value.sessionId;
    if (sessionId !== undefined && sessionId !== null && typeof sessionId !== "string") {
      return context.json({ error: "sessionId must be a string or null" }, 400);
    }

    const workspacePath = body.value.workspacePath;
    if (workspacePath !== undefined && workspacePath !== null && typeof workspacePath !== "string") {
      return context.json({ error: "workspacePath must be a string or null" }, 400);
    }

    const defaultAgentType = body.value.defaultAgentType;
    if (defaultAgentType !== undefined && !isAgentType(defaultAgentType)) {
      return context.json({ error: "defaultAgentType must be one of: codex, claude, trae" }, 400);
    }

    try {
      const result = new FeishuInboundService(db).receiveMessage({
        messageId,
        chatId,
        text,
        userId: typeof userId === "string" ? userId : null,
        sessionId: typeof sessionId === "string" ? sessionId : null,
        workspacePath: typeof workspacePath === "string" ? workspacePath : defaultWorkspacePath,
        defaultAgentType: isAgentType(defaultAgentType) ? defaultAgentType : undefined,
      });
      if (result.action === "message") {
        new ContextBudgetService(db).evaluate({ sessionId: result.session.id });
      }
      projectReadModelsUntilIdle(db);

      const selectedSessionId =
        result.action === "message" || result.action === "agent_new"
          ? result.session.id
          : result.action === "handoff"
            ? result.targetSessionId
            : result.action === "context_compact" || result.action === "context_status"
              ? result.sessionId
              : null;

      return context.json(
        {
          result,
          workspace: createWorkspaceSnapshot(db, { selectedSessionId }),
        },
        201,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Feishu message failed";
      if (message.startsWith("Session not found")) {
        return context.json({ error: message }, 404);
      }
      if (message.includes("agent type") || message.includes("required") || message.includes("archived")) {
        return context.json({ error: message }, 400);
      }
      if (message.startsWith("No events found")) {
        return context.json({ error: message }, 409);
      }
      return context.json({ error: message }, 500);
    }
  });

  app.get("/api/sessions/:sessionId/memory/archives", (context) => {
    try {
      const archives = new MemoryArchiveService(context.get("db"))
        .listArchives(context.req.param("sessionId"))
        .map(mapMemoryArchive);
      const response: ListMemoryArchivesResponse = { archives };
      return context.json(response);
    } catch (error) {
      const message = error instanceof Error ? error.message : "List memory archives failed";
      if (message.startsWith("Session not found")) {
        return context.json({ error: message }, 404);
      }
      return context.json({ error: message }, 500);
    }
  });

  app.post("/api/sessions/:sessionId/memory/archives", async (context) => {
    const body = await readJsonBody(context.req);
    if (!body.ok) {
      return context.json({ error: body.error }, 400);
    }

    const archiveDate = body.value.archiveDate;
    if (typeof archiveDate !== "string") {
      return context.json({ error: "archiveDate is required" }, 400);
    }

    try {
      const result = new MemoryArchiveService(context.get("db")).createDailyArchive({
        sessionId: context.req.param("sessionId"),
        archiveDate,
      });
      projectReadModelsUntilIdle(context.get("db"));
      const response: CreateMemoryArchiveResponse = {
        archive: mapMemoryArchive(result.archive),
        eventId: result.event.id,
      };
      return context.json(response, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Create memory archive failed";
      if (message.startsWith("Session not found")) {
        return context.json({ error: message }, 404);
      }
      if (message.includes("archiveDate")) {
        return context.json({ error: message }, 400);
      }
      if (message.startsWith("No events found")) {
        return context.json({ error: message }, 409);
      }
      return context.json({ error: message }, 500);
    }
  });

  app.post("/api/sessions/:sessionId/context/compact", async (context) => {
    const db = context.get("db");
    const body = await readOptionalJsonBody(context.req);
    if (!body.ok) {
      return context.json({ error: body.error }, 400);
    }

    const actorType = body.value.actorType ?? "web_user";
    if (!isAuditActorType(actorType)) {
      return context.json({ error: "actorType must be one of: web_user, feishu_user, system, agent" }, 400);
    }

    const actorRef = body.value.actorRef;
    if (actorRef !== undefined && actorRef !== null && typeof actorRef !== "string") {
      return context.json({ error: "actorRef must be a string or null" }, 400);
    }

    const budgetTokens = body.value.budgetTokens;
    if (
      budgetTokens !== undefined &&
      (typeof budgetTokens !== "number" || !Number.isInteger(budgetTokens) || budgetTokens <= 0)
    ) {
      return context.json({ error: "budgetTokens must be a positive integer" }, 400);
    }

    try {
      const result = new ContextBudgetService(db).compactNow({
        sessionId: context.req.param("sessionId"),
        createdBy: actorType === "agent" ? "agent" : actorType === "system" ? "system" : "user",
        budgetTokens: typeof budgetTokens === "number" ? budgetTokens : undefined,
      });
      new AuditLogStore(db).insert({
        actorType,
        actorRef: typeof actorRef === "string" ? actorRef : null,
        action: "compact",
        resourceType: "session",
        resourceId: context.req.param("sessionId"),
        payload: {
          contextPackId: result.compacted?.contextPack.id ?? result.contextPack?.id ?? null,
          eventId: result.compacted?.event.id ?? null,
          budgetTokens: typeof budgetTokens === "number" ? budgetTokens : null,
        },
      });
      projectReadModelsUntilIdle(db);

      const workspace = createWorkspaceSnapshot(db, { selectedSessionId: context.req.param("sessionId") });
      const response: CompactContextResponse = {
        contextPackId: result.compacted?.contextPack.id ?? result.contextPack?.id ?? "",
        eventId: result.compacted?.event.id ?? "",
        contextBudget: workspace.contextBudget,
        workspace,
      };

      return context.json(response, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Context compact failed";
      if (message.startsWith("Session not found")) {
        return context.json({ error: message }, 404);
      }
      if (message.startsWith("No events found")) {
        return context.json({ error: message }, 409);
      }
      if (message.includes("budget") || message.includes("threshold")) {
        return context.json({ error: message }, 400);
      }
      return context.json({ error: message }, 500);
    }
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

async function readOptionalJsonBody(request: { json: () => Promise<unknown> }): Promise<
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string }
> {
  try {
    const value = await request.json();
    if (value === null || value === undefined) {
      return { ok: true, value: {} };
    }
    if (!isRecord(value)) {
      return { ok: false, error: "Request body must be a JSON object" };
    }
    return { ok: true, value };
  } catch {
    return { ok: true, value: {} };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value);
}

function isAgentType(value: unknown): value is AgentType {
  return value === "codex" || value === "claude" || value === "trae";
}

function isAuditActorType(value: unknown): value is AuditActorType {
  return value === "web_user" || value === "feishu_user" || value === "system" || value === "agent";
}

function isAgentDefaultScopeType(value: unknown): value is AgentDefaultScopeType {
  return value === "user" || value === "channel" || value === "workspace" || value === "system";
}

function displayAgent(agentType: AgentType): string {
  if (agentType === "claude") {
    return "Claude";
  }
  if (agentType === "trae") {
    return "Trae";
  }
  return "Codex";
}

async function updateScheduleStatus(
  context: Context<AppBindings>,
  action: string,
  update: (
    service: SchedulerService,
    scheduleId: string,
    actorType: AuditActorType,
    actorRef: string | null,
  ) => ScheduleRecord,
) {
  const body = await readOptionalJsonBody(context.req);
  if (!body.ok) {
    return context.json({ error: body.error }, 400);
  }

  const actorType = body.value.actorType ?? "web_user";
  if (!isAuditActorType(actorType)) {
    return context.json({ error: "actorType must be one of: web_user, feishu_user, system, agent" }, 400);
  }

  const actorRef = body.value.actorRef;
  if (actorRef !== undefined && actorRef !== null && typeof actorRef !== "string") {
    return context.json({ error: "actorRef must be a string or null" }, 400);
  }

  const scheduleId = context.req.param("scheduleId");
  if (!scheduleId) {
    return context.json({ error: "scheduleId is required" }, 400);
  }

  try {
    const schedule = update(
      new SchedulerService(context.get("db")),
      scheduleId,
      actorType,
      typeof actorRef === "string" ? actorRef : null,
    );
    const response: UpdateScheduleResponse = { schedule: mapSchedule(schedule) };
    return context.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : `Schedule ${action} failed`;
    if (message.startsWith("Schedule not found")) {
      return context.json({ error: message }, 404);
    }
    if (message.includes("cron")) {
      return context.json({ error: message }, 400);
    }
    return context.json({ error: message }, 500);
  }
}

function mapSchedule(schedule: ScheduleRecord): WorkspaceSchedule {
  return {
    id: schedule.id,
    sessionId: schedule.sessionId,
    status: schedule.status,
    kind: schedule.kind,
    cronExpr: schedule.cronExpr,
    runAt: schedule.runAt,
    timezone: schedule.timezone,
    nextRunAt: schedule.nextRunAt,
    lastRunAt: schedule.lastRunAt,
  };
}

function mapAgentDefault(record: AgentDefaultRecord): AgentDefault {
  return {
    id: record.id,
    scopeType: record.scopeType,
    scopeRef: record.scopeRef,
    agentType: record.agentType,
    params: record.params,
    updatedAt: record.updatedAt,
  };
}

function mapMemoryArchive(record: MemoryArchiveRecord): MemoryArchive {
  return {
    id: record.id,
    sessionId: record.sessionId,
    archiveDate: record.archiveDate,
    sourceGlobalSeqStart: record.sourceGlobalSeqStart,
    sourceGlobalSeqEnd: record.sourceGlobalSeqEnd,
    summary: record.summary,
    updatedAt: record.updatedAt,
  };
}

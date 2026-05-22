import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import type { SqliteDatabase } from "../db/migrate.js";
import { WorkspaceService } from "../services/workspace.js";
import { InboundService } from "../services/inbound.js";
import { DeliveryWorker } from "../services/delivery.js";
import { SchedulerService } from "../services/scheduler.js";
import { ContextService } from "../services/context.js";
import { HandoffService } from "../services/handoff.js";
import { ChannelConfigStore } from "../stores/channel-config-store.js";
import { AgentDefaultStore } from "../stores/agent-default-store.js";
import { AuditLogStore, type AuditActorType } from "../stores/audit-log-store.js";
import { EventStore } from "../stores/event-store.js";
import { SessionStore } from "../stores/session-store.js";
import { computeNextCronRun, getSchedulePayloadText, normalizeScheduleTimezone, summarizeSchedulePayload } from "../stores/schedule-store.js";
import { PermissionRequestStore } from "../stores/permission-request-store.js";
import { OutboxStore } from "../stores/outbox-store.js";
import { RuntimeAdapterRegistry } from "../runtime/registry.js";
import { RuntimeSupervisor } from "../runtime/supervisor.js";
import { RuntimeService } from "../runtime/service.js";
import { WorkspacePolicy, WorkspacePolicyError } from "../security/workspace-policy.js";
import { ChannelRegistry } from "../channels/registry.js";
import type { WorkspaceSchedule, WorkspaceScheduleRun } from "../../shared/workspace.js";
import type { ScheduleRecord } from "../stores/schedule-store.js";
import type { ScheduleRunRecord } from "../stores/schedule-run-store.js";
import type { AgentDefaultRecord } from "../stores/agent-default-store.js";
import type { PermissionRequestRecord } from "../stores/permission-request-store.js";
import type { JsonValue } from "../../shared/json.js";
import { formatUtc8 } from "../../shared/time.js";

export type AppOptions = {
  workspacePolicy: WorkspacePolicy;
  runtimeRegistry: RuntimeAdapterRegistry;
  runtimeSupervisor: RuntimeSupervisor;
  channelRegistry: ChannelRegistry;
};

export function createApp(db: SqliteDatabase, options: AppOptions) {
  const app = new Hono();

  const {
    workspacePolicy,
    runtimeRegistry,
    runtimeSupervisor,
    channelRegistry,
  } = options;

  const eventStore = new EventStore(db);
  const sessionStore = new SessionStore(db, eventStore);
  const permissionRequests = new PermissionRequestStore(db);
  const runtimeService = new RuntimeService(db, runtimeSupervisor, workspacePolicy);

  // ── Middleware ──

  app.use("*", cors());
  app.use("*", async (c, next) => { await next(); });

  // ── Health / Root ──

  app.get("/", (c) =>
    c.json({ ok: true, service: "miniagent" }),
  );

  app.get("/api/health", (c) =>
    c.json({ ok: true }),
  );

  // ── Workspace ──

  app.get("/api/workspace", (c) => {
    const workspaceService = new WorkspaceService(db, runtimeSupervisor);
    return c.json(
      workspaceService.getSnapshot(c.req.query("sessionId") || null),
    );
  });

  // ── Events ──

  app.get("/api/events", (c) => {
    const sessionId = c.req.query("sessionId") || undefined;
    const afterGlobalSeq = Number(c.req.query("afterGlobalSeq") ?? 0);
    const limit = Number(c.req.query("limit") ?? 100);

    if (!Number.isInteger(afterGlobalSeq) || afterGlobalSeq < 0) {
      return c.json({ error: "afterGlobalSeq must be a non-negative integer" }, 400);
    }
    if (!Number.isInteger(limit) || limit <= 0 || limit > 500) {
      return c.json({ error: "limit must be an integer between 1 and 500" }, 400);
    }

    const events = eventStore.listAfterGlobalSeq({ sessionId, afterGlobalSeq, limit });
    return c.json({ events });
  });

  app.get("/api/events/stream", (c) => {
    const sessionId = c.req.query("sessionId") || undefined;
    const afterGlobalSeq = Number(c.req.query("afterGlobalSeq") ?? 0);
    const limit = Number(c.req.query("limit") ?? 100);

    if (!Number.isInteger(afterGlobalSeq) || afterGlobalSeq < 0) {
      return c.json({ error: "afterGlobalSeq must be a non-negative integer" }, 400);
    }
    if (!Number.isInteger(limit) || limit <= 0 || limit > 500) {
      return c.json({ error: "limit must be an integer between 1 and 500" }, 400);
    }

    let cursor = afterGlobalSeq;

    return streamSSE(c, async (stream) => {
      // Send initial historical events
      const initial = eventStore.listAfterGlobalSeq({ sessionId, afterGlobalSeq, limit });
      for (const event of initial) {
        await stream.writeSSE({
          id: String(event.globalSeq),
          event: event.type,
          data: JSON.stringify(event),
        });
        cursor = event.globalSeq;
      }

      // Poll for new events every 500ms
      while (!stream.aborted) {
        await stream.sleep(500);
        try {
          const newEvents = new EventStore(db).listAfterGlobalSeq({
            sessionId,
            afterGlobalSeq: cursor,
            limit: 50,
          });
          for (const event of newEvents) {
            await stream.writeSSE({
              id: String(event.globalSeq),
              event: event.type,
              data: JSON.stringify(event),
            });
            cursor = event.globalSeq;
          }
        } catch {
          // DB error — skip this tick
        }
      }
    });
  });

  // ── Sessions ──

  app.post("/api/sessions", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return c.json({ error: "Request body must be valid JSON" }, 400);
    }
    const value = body as Record<string, unknown>;

    const requestedAgentType = value.agentType;
    if (requestedAgentType !== undefined && !isAgentType(requestedAgentType)) {
      return c.json({ error: "agentType must be one of: codex, claude, trae" }, 400);
    }

    const title = value.title;
    if (title !== undefined && typeof title !== "string") {
      return c.json({ error: "title must be a string" }, 400);
    }

    const workspacePath = value.workspacePath;
    if (workspacePath !== undefined && typeof workspacePath !== "string") {
      return c.json({ error: "workspacePath must be a string" }, 400);
    }

    let effectiveWorkspacePath: string;
    try {
      effectiveWorkspacePath = workspacePolicy.assertAllowed(
        (typeof workspacePath === "string" ? workspacePath.trim() : "") || process.cwd(),
      );
    } catch (error) {
      if (error instanceof WorkspacePolicyError) {
        new AuditLogStore(db).insert({
          actorType: "web_user",
          action: "workspace_denied",
          resourceType: "workspace",
          resourceId: error.workspacePath,
          payload: { workspacePath: error.workspacePath, reason: error.reason },
        });
        return c.json({ error: error.message }, 403);
      }
      throw error;
    }

    const defaultAgent = new AgentDefaultStore(db).resolve({ workspacePath: effectiveWorkspacePath });
    const agentType = (requestedAgentType as string) ?? defaultAgent?.agentType ?? "claude";
    const trimmedTitle = typeof title === "string" ? title.trim() : "";

    const session = sessionStore.createSession({
      name: trimmedTitle,
      title: trimmedTitle || `${displayAgent(agentType)} session`,
      agentType,
      workspacePath: effectiveWorkspacePath,
      channelType: "web",
    });

    const workspaceService = new WorkspaceService(db, runtimeSupervisor);
    return c.json(
      {
        sessionId: session.id,
        workspace: workspaceService.getSnapshot(session.id),
      },
      201,
    );
  });

  app.patch("/api/sessions/:sessionId", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return c.json({ error: "Request body must be valid JSON" }, 400);
    }
    const value = body as Record<string, unknown>;
    const name = value.name;
    if (typeof name !== "string") {
      return c.json({ error: "name must be a string" }, 400);
    }
    if (name.trim().length === 0) {
      return c.json({ error: "name is required" }, 400);
    }

    try {
      const session = sessionStore.updateSessionName(c.req.param("sessionId"), name);
      const workspaceService = new WorkspaceService(db, runtimeSupervisor);
      return c.json({
        sessionId: session.id,
        workspace: workspaceService.getSnapshot(session.id),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Session update failed";
      if (message.startsWith("Session not found")) {
        return c.json({ error: message }, 404);
      }
      return c.json({ error: message }, 500);
    }
  });

  // ── Messages ──

  app.post("/api/sessions/:sessionId/messages", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return c.json({ error: "Request body must be valid JSON" }, 400);
    }
    const value = body as Record<string, unknown>;

    const text = value.text;
    if (typeof text !== "string" || text.trim().length === 0) {
      return c.json({ error: "text is required" }, 400);
    }

    const actorRef = value.actorRef;
    if (actorRef !== undefined && actorRef !== null && typeof actorRef !== "string") {
      return c.json({ error: "actorRef must be a string or null" }, 400);
    }

    try {
      const sessionId = c.req.param("sessionId");
      const existingSession = sessionStore.getSession(sessionId);

      const inbound = new InboundService(db, "web", { workspacePolicy });
      const result = existingSession
        ? inbound.receiveOnSession(existingSession, {
            messageId: `web:${Date.now()}`,
            userId: (typeof actorRef === "string" ? actorRef : "web_user"),
            text,
          })
        : inbound.receiveMessage({
            messageId: `web:${Date.now()}`,
            chatId: sessionId,
            userId: (typeof actorRef === "string" ? actorRef : "web_user"),
            text,
            chatType: "private",
          });

      // Auto-start run for queued task
      if (result.taskId) {
        try {
          runtimeService.startNextQueuedTask(result.session.id);
        } catch {
          // Already active or no queued task — safe to ignore
        }
      }

      const workspaceService = new WorkspaceService(db, runtimeSupervisor);
      return c.json(
        {
          taskId: result.taskId ?? "",
          eventId: "",
          workspace: workspaceService.getSnapshot(result.session.id),
        },
        201,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Message send failed";
      if (message.startsWith("Session not found")) {
        return c.json({ error: message }, 404);
      }
      return c.json({ error: message }, 500);
    }
  });

  // ── Handoffs ──

  app.post("/api/sessions/:sessionId/handoffs", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return c.json({ error: "Request body must be valid JSON" }, 400);
    }
    const value = body as Record<string, unknown>;

    const targetAgentType = value.targetAgentType;
    if (!isAgentType(targetAgentType)) {
      return c.json({ error: "targetAgentType must be one of: codex, claude, trae" }, 400);
    }

    const actorType = value.actorType ?? "web_user";
    const actorRef = value.actorRef;
    const targetTitle = value.targetTitle;

    try {
      const handoffService = new HandoffService(db);
      const result = handoffService.handoff({
        sourceSessionId: c.req.param("sessionId"),
        targetAgentType: targetAgentType as "codex" | "claude" | "trae",
        targetTitle: typeof targetTitle === "string" ? targetTitle : undefined,
        actorType: typeof actorType === "string" ? actorType : "web_user",
        actorRef: typeof actorRef === "string" ? actorRef : undefined,
      });

      const workspaceService = new WorkspaceService(db, runtimeSupervisor);
      return c.json(
        {
          targetSessionId: result.targetSessionId,
          targetTaskId: result.targetTaskId,
          sourceContextPackId: result.sourceContextPackId,
          requestedEventId: "",
          createdEventId: result.eventId,
          workspace: workspaceService.getSnapshot(result.targetSessionId),
        },
        201,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Handoff failed";
      if (message.includes("not found")) {
        return c.json({ error: message }, 404);
      }
      return c.json({ error: message }, 500);
    }
  });

  // ── Runs ──

  app.post("/api/sessions/:sessionId/runs/start", (c) => {
    try {
      const result = runtimeService.startNextQueuedTask(c.req.param("sessionId"));
      if (!result) {
        return c.json({ error: "No queued task" }, 409);
      }

      const workspaceService = new WorkspaceService(db, runtimeSupervisor);
      return c.json(
        {
          taskId: result.task.id,
          runId: result.run.id,
          status: result.run.status,
          workspace: workspaceService.getSnapshot(c.req.param("sessionId")),
        },
        201,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Runtime start failed";
      if (message.startsWith("Session not found")) {
        return c.json({ error: message }, 404);
      }
      if (message.includes("No queued task") || message.includes("active run")) {
        return c.json({ error: message }, 409);
      }
      if (error instanceof WorkspacePolicyError || message.startsWith("Workspace denied")) {
        return c.json({ error: message }, 403);
      }
      return c.json({ error: message }, 500);
    }
  });

  app.post("/api/runs/:runId/stop", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const value = (body && typeof body === "object" && !Array.isArray(body) ? body : {}) as Record<string, unknown>;

    const actorType = value.actorType ?? "web_user";
    if (!isAuditActorType(actorType)) {
      return c.json({ error: "actorType must be one of: web_user, feishu_user, qq_user, telegram_user, discord_user, system, agent" }, 400);
    }

    const runId = c.req.param("runId");
    const run = sessionStore.getRun(runId);
    if (!run) {
      return c.json({ error: `Run not found: ${runId}` }, 404);
    }

    try {
      runtimeSupervisor.stop(runId);
      new AuditLogStore(db).insert({
        actorType: actorType as AuditActorType,
        action: "run_stop",
        resourceType: "run",
        resourceId: runId,
        payload: { sessionId: run.sessionId },
      });

      const stopped = sessionStore.getRun(runId) ?? run;
      const workspaceService = new WorkspaceService(db, runtimeSupervisor);
      return c.json({
        runId,
        status: stopped.status,
        workspace: workspaceService.getSnapshot(run.sessionId),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Runtime stop failed";
      if (message.includes("not active")) {
        return c.json({ error: message }, 409);
      }
      return c.json({ error: message }, 500);
    }
  });

  // ── Permissions ──

  app.get("/api/runs/:runId/permissions", (c) => {
    const permissions = permissionRequests.listByRun(c.req.param("runId")).map(mapPermissionRequest);
    return c.json({ permissions });
  });

  app.post("/api/runs/:runId/permissions/:requestId/respond", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return c.json({ error: "Request body must be valid JSON" }, 400);
    }
    const value = body as Record<string, unknown>;

    const outcome = value.outcome;
    if (outcome !== "selected" && outcome !== "cancelled") {
      return c.json({ error: "outcome must be selected or cancelled" }, 400);
    }

    const optionId = value.optionId;
    if (optionId !== undefined && optionId !== null && typeof optionId !== "string") {
      return c.json({ error: "optionId must be a string or null" }, 400);
    }

    try {
      runtimeSupervisor.respondPermission(c.req.param("runId"), {
        requestId: c.req.param("requestId"),
        outcome,
        optionId: optionId ?? undefined,
      });
      const permissions = permissionRequests.listByRun(c.req.param("runId")).map(mapPermissionRequest);
      return c.json({ permissions });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Respond permission failed";
      if (message.includes("not active") || message.includes("not pending")) {
        return c.json({ error: message }, 409);
      }
      return c.json({ error: message }, 500);
    }
  });

  // ── Context ──

  app.post("/api/sessions/:sessionId/context/compact", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const value = (body && typeof body === "object" && !Array.isArray(body) ? body : {}) as Record<string, unknown>;

    const budgetTokens = value.budgetTokens;
    if (
      budgetTokens !== undefined &&
      (typeof budgetTokens !== "number" || !Number.isInteger(budgetTokens) || budgetTokens <= 0)
    ) {
      return c.json({ error: "budgetTokens must be a positive integer" }, 400);
    }

    try {
      const contextService = new ContextService(db);
      const result = contextService.compact(
        c.req.param("sessionId"),
        { budgetTokens: typeof budgetTokens === "number" ? budgetTokens : undefined },
      );

      const workspaceService = new WorkspaceService(db, runtimeSupervisor);
      const workspace = workspaceService.getSnapshot(c.req.param("sessionId"));
      return c.json(
        {
          contextPackId: result.contextPackId,
          eventId: result.eventId,
          contextBudget: workspace.contextBudget,
          workspace,
        },
        201,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Context compact failed";
      if (message.startsWith("Session not found")) {
        return c.json({ error: message }, 404);
      }
      return c.json({ error: message }, 500);
    }
  });

  app.post("/api/sessions/:sessionId/context/restart", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const value = (body && typeof body === "object" && !Array.isArray(body) ? body : {}) as Record<string, unknown>;

    const actorType = value.actorType ?? "web_user";
    const actorRef = value.actorRef;

    try {
      const contextService = new ContextService(db);
      const result = contextService.restart(
        c.req.param("sessionId"),
        {
          actorType: typeof actorType === "string" ? actorType : "web_user",
          actorRef: typeof actorRef === "string" ? actorRef : undefined,
        },
      );

      const workspaceService = new WorkspaceService(db, runtimeSupervisor);
      return c.json(
        {
          contextPackId: result.contextPackId,
          taskId: result.taskId,
          eventId: result.eventId,
          workspace: workspaceService.getSnapshot(c.req.param("sessionId")),
        },
        201,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Restart from ContextPack failed";
      if (message.startsWith("Session not found")) {
        return c.json({ error: message }, 404);
      }
      return c.json({ error: message }, 500);
    }
  });

  // ── Agents ──

  app.get("/api/agents", async (c) => {
    const probes = await runtimeRegistry.listAgents();
    const agents = probes.map((probe) => ({
      agentType: probe.agentType,
      runtimeKind: "acp" as const,
      label: displayAgent(probe.agentType),
      status: probe.status,
      command: probe.command,
      version: probe.version,
      message: probe.message,
      checkedAt: probe.checkedAt,
      capabilities: {
        textStreaming: true,
        structuredEvents: true,
        nativeCompact: false,
        resume: true,
        sessionExport: false,
        permissionPrompt: true,
        imageInput: false,
      },
    }));
    return c.json({ agents });
  });

  // ── Agent Defaults ──

  app.get("/api/agent-defaults/resolve", (c) => {
    try {
      const resolved = new AgentDefaultStore(db).resolve({
        userRef: c.req.query("userRef") ?? undefined,
        channelRef: c.req.query("channelRef") ?? undefined,
        workspacePath: c.req.query("workspacePath") ?? undefined,
      });
      if (!resolved) {
        return c.json({ error: "No default agent found" }, 404);
      }
      return c.json({ default: mapAgentDefault(resolved) });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Resolve default agent failed";
      return c.json({ error: message }, 500);
    }
  });

  app.post("/api/agent-defaults", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return c.json({ error: "Request body must be valid JSON" }, 400);
    }
    const value = body as Record<string, unknown>;

    const scopeType = value.scopeType;
    if (!isAgentDefaultScopeType(scopeType)) {
      return c.json({ error: "scopeType must be one of: user, channel, workspace, system" }, 400);
    }

    const scopeRef = value.scopeRef;
    if (typeof scopeRef !== "string" || scopeRef.trim().length === 0) {
      return c.json({ error: "scopeRef is required" }, 400);
    }

    const agentType = value.agentType;
    if (!isAgentType(agentType)) {
      return c.json({ error: "agentType must be one of: codex, claude, trae" }, 400);
    }

    const saved = new AgentDefaultStore(db).set({
      scopeType: scopeType as "user" | "channel" | "workspace" | "system",
      scopeRef,
      agentType,
      params: value.params as JsonValue | undefined,
    });

    return c.json({ default: mapAgentDefault(saved) }, 201);
  });

  // ── Skills ──

  app.get("/api/skills", async () => {
    const dirs = [
      join(process.cwd(), ".claude", "skills"),
      join(homedir(), ".claude", "skills"),
    ];
    const seen = new Set<string>();
    const results: Array<{ name: string; description: string; source: string }> = [];
    for (const skillsDir of dirs) {
      let entries: string[];
      try {
        entries = await readdir(skillsDir);
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (seen.has(entry)) continue;
        const entryPath = join(skillsDir, entry);
        const s = await stat(entryPath).catch(() => null);
        if (!s?.isDirectory()) continue;
        seen.add(entry);
        let mdContent = "";
        for (const file of ["SKILL.md", "skill.md", "README.md"]) {
          mdContent = await readFile(join(entryPath, file), "utf-8").catch(() => "");
          if (mdContent) break;
        }
        results.push({
          name: entry,
          description: parseFrontmatterDescription(mdContent) ?? "",
          source: skillsDir === dirs[0] ? "project" : "user",
        });
      }
    }
    return new Response(JSON.stringify({ skills: results }), {
      headers: { "Content-Type": "application/json" },
    });
  });

  // ── Channels ──

  app.get("/api/channels", (c) => {
    const configStore = new ChannelConfigStore(db);
    const channels = configStore.listChannels().map((ch) => ({
      id: ch.channelId,
      label: ch.label,
      status: (ch.channelId === "web" ? "connected" : ch.configured ? "connected" : "available") as "connected" | "available" | "disconnected",
      description: `${ch.label} channel`,
      config: ch.config,
    }));
    return c.json({ channels });
  });

  app.put("/api/channels/:channelId/config", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return c.json({ error: "Body must be a JSON object" }, 400);
    }

    const configStore = new ChannelConfigStore(db);
    const config: Record<string, string> = {};
    for (const [key, value] of Object.entries(body)) {
      if (typeof value === "string") config[key] = value;
    }

    const channelId = c.req.param("channelId");
    const nextConfig = { ...configStore.get(channelId), ...config };
    let startResult: { ok: boolean; message: string } | null = null;
    if (channelId !== "web" && configStore.isConfigured(channelId, nextConfig)) {
      startResult = await channelRegistry.startChannel(channelId, nextConfig);
      if (!startResult.ok) {
        return c.json({ error: startResult.message, channelStart: startResult }, 400);
      }
    }

    const result = configStore.set(channelId, config);
    return c.json({ config: result, channelStart: startResult });
  });

  app.post("/api/channels/:channelId/test", async (c) => {
    const result = await channelRegistry.testChannel(c.req.param("channelId"));
    return c.json(result, result.ok ? 200 : 400);
  });

  // ── WeChat QR Login ──

  app.get("/api/channels/wechat/qrcode", async (c) => {
    try {
      const res = await fetch("https://ilinkai.weixin.qq.com/ilink/bot/get_bot_qrcode?bot_type=3", {
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return c.json({ error: `Upstream ${res.status}` }, 502);
      const data = await res.json() as { qrcode?: string; qrcode_url?: string; token?: string; [k: string]: unknown };
      return c.json(data);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "Failed" }, 500);
    }
  });

  app.get("/api/channels/wechat/qrcode-status", async (c) => {
    const qrcode = c.req.query("qrcode");
    if (!qrcode) return c.json({ error: "Missing qrcode param" }, 400);
    try {
      const res = await fetch(`https://ilinkai.weixin.qq.com/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`, {
        headers: { "Content-Type": "application/json", "iLink-App-ClientVersion": "1" },
        signal: AbortSignal.timeout(35_000),
      });
      if (!res.ok) return c.json({ error: `Upstream ${res.status}` }, 502);
      const data = await res.json() as { status?: string; bot_token?: string; baseurl?: string; [k: string]: unknown };
      return c.json(data);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "Failed" }, 500);
    }
  });

  // ── DingTalk Webhook ──
  app.post("/api/webhooks/dingtalk", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return c.json({ error: "Invalid body" }, 400);
    }

    const callback = body as import("../channels/dingtalk.js").DingTalkCallback;
    const { DingTalkChannel } = await import("../channels/dingtalk.js");
    const msg = DingTalkChannel.parseCallback(callback);
    if (!msg) return c.json({ success: true }); // Skip non-text messages

    // Cache staffId for C2C replies
    const adapter = channelRegistry.get("dingtalk");
    if (adapter && "handleCallback" in adapter) {
      (adapter as import("../channels/dingtalk.js").DingTalkChannel).handleCallback(callback);
    }

    try {
      const inbound = new InboundService(db, "dingtalk", { workspacePolicy });
      const result = inbound.receiveMessage(msg);
      if (result.action === "message" && result.taskId) {
        try { runtimeService.startNextQueuedTask(result.session.id); } catch { /* already active */ }
      }
    } catch (err) {
      console.error("[DingTalk] Webhook message handling failed:", err);
    }

    return c.json({ success: true });
  });

  // ── Schedules ──

  app.get("/api/schedules", (c) => {
    const sessionId = c.req.query("sessionId");
    if (!sessionId) {
      return c.json({ error: "sessionId is required" }, 400);
    }

    const schedulerService = new SchedulerService(db, runtimeService);
    const schedules = schedulerService.list(sessionId);
    return c.json({ schedules: schedules.map(mapSchedule) });
  });

  app.post("/api/schedules", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return c.json({ error: "Request body must be valid JSON" }, 400);
    }
    const value = body as Record<string, unknown>;

    const sessionId = value.sessionId;
    if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
      return c.json({ error: "sessionId is required" }, 400);
    }

    const kind = value.kind;
    if (kind !== "once" && kind !== "cron") {
      return c.json({ error: "kind must be once or cron" }, 400);
    }
    const payload = value.payload;
    if (payload !== undefined && (payload === null || typeof payload !== "object" || Array.isArray(payload))) {
      return c.json({ error: "payload must be an object" }, 400);
    }

    try {
      const schedulerService = new SchedulerService(db, runtimeService);
      const schedule = schedulerService.create({
        sessionId: sessionId.trim(),
        kind: kind as "once" | "cron",
        cronExpr: typeof value.cronExpr === "string" ? value.cronExpr : null,
        runAt: typeof value.runAt === "string" ? value.runAt : null,
        timezone: typeof value.timezone === "string" ? value.timezone : undefined,
        payload: payload as JsonValue | undefined,
        actorType: typeof value.actorType === "string" ? value.actorType : "web_user",
        actorRef: typeof value.actorRef === "string" ? value.actorRef : undefined,
      });
      return c.json({ schedule: mapSchedule(schedule) }, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Create schedule failed";
      if (message.startsWith("Session not found")) {
        return c.json({ error: message }, 404);
      }
      if (
        message.startsWith("cronExpr") ||
        message.startsWith("runAt") ||
        message.startsWith("timezone") ||
        message.startsWith("Invalid cron") ||
        message.startsWith("Could not compute")
      ) {
        return c.json({ error: message }, 400);
      }
      return c.json({ error: message }, 500);
    }
  });

  app.post("/api/schedules/preview", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return c.json({ error: "Request body must be valid JSON" }, 400);
    }
    const value = body as Record<string, unknown>;
    const kind = value.kind;
    if (kind !== "once" && kind !== "cron") {
      return c.json({ error: "kind must be once or cron" }, 400);
    }

    const timezone = typeof value.timezone === "string" ? value.timezone : "Asia/Shanghai";
    try {
      const cleanTimezone = normalizeScheduleTimezone(timezone);
      if (kind === "cron") {
        const cronExpr = typeof value.cronExpr === "string" ? value.cronExpr : "";
        const nextRunAt = computeNextCronRun(cronExpr, undefined, cleanTimezone);
        return c.json({ nextRunAt, timezone: cleanTimezone });
      }

      const runAt = typeof value.runAt === "string" ? value.runAt : "";
      const date = new Date(runAt);
      if (Number.isNaN(date.getTime())) throw new Error("runAt must be a valid date");
      return c.json({ nextRunAt: formatUtc8(date), timezone: cleanTimezone });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Preview schedule failed";
      return c.json({ error: message }, 400);
    }
  });

  app.get("/api/schedules/:scheduleId/runs", (c) => {
    const scheduleId = c.req.param("scheduleId");
    const schedulerService = new SchedulerService(db, runtimeService);
    const runs = schedulerService.listRuns(scheduleId);
    return c.json({ runs: runs.map(mapScheduleRun) });
  });

  app.patch("/api/schedules/:scheduleId", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return c.json({ error: "Request body must be valid JSON" }, 400);
    }
    const value = body as Record<string, unknown>;
    const kind = value.kind;
    if (kind !== "once" && kind !== "cron") {
      return c.json({ error: "kind must be once or cron" }, 400);
    }
    const payload = value.payload;
    if (payload !== undefined && (payload === null || typeof payload !== "object" || Array.isArray(payload))) {
      return c.json({ error: "payload must be an object" }, 400);
    }

    try {
      const schedulerService = new SchedulerService(db, runtimeService);
      const schedule = schedulerService.update(c.req.param("scheduleId"), {
        kind,
        cronExpr: typeof value.cronExpr === "string" ? value.cronExpr : null,
        runAt: typeof value.runAt === "string" ? value.runAt : null,
        timezone: typeof value.timezone === "string" ? value.timezone : undefined,
        payload: payload as JsonValue | undefined,
      });
      if (!schedule) return c.json({ error: "Schedule not found" }, 404);
      return c.json({ schedule: mapSchedule(schedule) });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Update schedule failed";
      if (
        message.startsWith("Cannot edit") ||
        message.startsWith("cronExpr") ||
        message.startsWith("runAt") ||
        message.startsWith("timezone") ||
        message.startsWith("Invalid cron") ||
        message.startsWith("Could not compute")
      ) {
        return c.json({ error: message }, 400);
      }
      return c.json({ error: message }, 500);
    }
  });

  app.post("/api/schedules/due/run", async (c) => {
    try {
      const schedulerService = new SchedulerService(db, runtimeService);
      const { triggered } = schedulerService.runDue();

      const workspaceService = new WorkspaceService(db, runtimeSupervisor);
      const selectedSessionId = triggered[0]?.schedule.sessionId ?? null;

      return c.json({
        triggered: triggered.map((t) => ({ schedule: mapSchedule(t.schedule), taskId: t.taskId })),
        workspace: workspaceService.getSnapshot(selectedSessionId),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Run due schedules failed";
      return c.json({ error: message }, 500);
    }
  });

  app.post("/api/schedules/:scheduleId/pause", (c) =>
    handleScheduleStatusUpdate(c, db, "pause"),
  );

  app.post("/api/schedules/:scheduleId/resume", (c) =>
    handleScheduleStatusUpdate(c, db, "resume"),
  );

  app.post("/api/schedules/:scheduleId/cancel", (c) =>
    handleScheduleStatusUpdate(c, db, "cancel"),
  );

  return app;
}

// ── Helpers ──

function isAgentType(value: unknown): value is string {
  return value === "codex" || value === "claude" || value === "trae";
}

function isAuditActorType(value: unknown): value is AuditActorType {
  return value === "web_user" || value === "feishu_user" || value === "qq_user" || value === "telegram_user" || value === "discord_user" || value === "system" || value === "agent";
}

function isAgentDefaultScopeType(value: unknown): value is string {
  return value === "user" || value === "channel" || value === "workspace" || value === "system";
}

function displayAgent(agentType: string): string {
  if (agentType === "claude") return "Claude";
  if (agentType === "trae") return "Trae";
  return "Codex";
}

function mapSchedule(record: ScheduleRecord): WorkspaceSchedule {
  return {
    id: record.id,
    sessionId: record.sessionId,
    status: record.status,
    kind: record.kind,
    cronExpr: record.cronExpr,
    runAt: record.runAt,
    timezone: record.timezone,
    payloadText: getSchedulePayloadText(record.payload),
    payloadSummary: summarizeSchedulePayload(record.payload),
    nextRunAt: record.nextRunAt,
    lastRunAt: record.lastRunAt,
  };
}

function mapScheduleRun(record: ScheduleRunRecord): WorkspaceScheduleRun {
  return {
    id: record.id,
    scheduleId: record.scheduleId,
    sessionId: record.sessionId,
    taskId: record.taskId,
    runId: record.runId,
    scheduledFor: record.scheduledFor,
    payloadSummary: record.payloadSummary,
    status: (record.taskStatus ?? record.status) as WorkspaceScheduleRun["status"],
    error: record.error,
    createdAt: record.createdAt,
  };
}

function mapAgentDefault(record: AgentDefaultRecord) {
  return {
    id: record.id,
    scopeType: record.scopeType,
    scopeRef: record.scopeRef,
    agentType: record.agentType,
    params: record.params,
    updatedAt: record.updatedAt,
  };
}

function mapPermissionRequest(record: PermissionRequestRecord) {
  return {
    id: record.id,
    sessionId: record.sessionId,
    runId: record.runId,
    taskId: record.taskId,
    eventId: record.eventId,
    requestId: record.acpRequestId,
    protocol: record.protocol,
    status: record.status,
    prompt: record.prompt,
    options: record.options,
    toolCall: record.toolCall,
    selectedOptionId: record.selectedOptionId,
    expiresAt: record.expiresAt,
    resolvedAt: record.resolvedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function parseFrontmatterDescription(content: string): string | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const frontmatter = match[1];
  const descMatch = frontmatter.match(/^description:\s*>-?\s*\n([\s\S]*?)(?=\n\w|\n---|$)/m);
  if (descMatch) return descMatch[1].replace(/^\s+/, "").trim();
  const simpleMatch = frontmatter.match(/^description:\s*(.+)/m);
  if (simpleMatch) return simpleMatch[1].trim();
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function handleScheduleStatusUpdate(
  c: any,
  db: SqliteDatabase,
  action: "pause" | "resume" | "cancel",
) {
  const scheduleId = c.req.param("scheduleId");
  const schedulerService = new SchedulerService(db);

  try {
    const schedule =
      action === "pause" ? schedulerService.pause(scheduleId) :
      action === "resume" ? schedulerService.resume(scheduleId) :
      schedulerService.cancel(scheduleId);

    return c.json({ schedule: mapSchedule(schedule!) });
  } catch (error) {
    const message = error instanceof Error ? error.message : `Schedule ${action} failed`;
    return c.json({ error: message }, 500);
  }
}

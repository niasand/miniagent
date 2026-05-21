import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, disposeTestDb } from "./helpers.js";
import type { SqliteDatabase } from "../src/server/db/migrate.js";
import { createApp } from "../src/server/http/app.js";
import { WorkspacePolicy } from "../src/server/security/workspace-policy.js";
import { RuntimeAdapterRegistry } from "../src/server/runtime/registry.js";
import { RuntimeSupervisor } from "../src/server/runtime/supervisor.js";
import { ChannelRegistry } from "../src/server/channels/registry.js";
import { OutboxStore } from "../src/server/stores/outbox-store.js";
import { EventStore } from "../src/server/stores/event-store.js";
import { SessionStore } from "../src/server/stores/session-store.js";
import type { Hono } from "hono";

let db: SqliteDatabase;
let app: Hono;
let channelRegistry: ChannelRegistry;

beforeEach(() => {
  db = createTestDb();
  const workspacePolicy = new WorkspacePolicy([process.cwd()]);
  const runtimeRegistry = new RuntimeAdapterRegistry();
  const outboxStore = new OutboxStore(db);
  const runtimeSupervisor = new RuntimeSupervisor({ db, adapterRegistry: runtimeRegistry, outboxStore });
  channelRegistry = new ChannelRegistry(db, () => {});
  channelRegistry.startChannel = async () => ({ ok: true, message: "Started" });

  app = createApp(db, {
    workspacePolicy,
    runtimeRegistry,
    runtimeSupervisor,
    channelRegistry,
  });
});

afterEach(() => disposeTestDb(db));

// Helper to make requests through Hono
function request(path: string, options?: RequestInit) {
  const url = `http://localhost${path}`;
  return app.request(url, options);
}

function postJson(path: string, body: unknown) {
  return request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function putJson(path: string, body: unknown) {
  return request(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function patchJson(path: string, body: unknown) {
  return request(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ── Health ──

describe("GET /", () => {
  it("returns service info", async () => {
    const res = await request("/");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.service).toBe("miniagent");
  });
});

describe("GET /api/health", () => {
  it("returns ok", async () => {
    const res = await request("/api/health");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
  });
});

// ── Workspace ──

describe("GET /api/workspace", () => {
  it("returns empty workspace", async () => {
    const res = await request("/api/workspace");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.sessions).toEqual([]);
    expect(data.messages).toEqual([]);
    expect(data.runtime).toBeDefined();
  });

  it("returns sessions after creation", async () => {
    await postJson("/api/sessions", { title: "Test session" });
    const res = await request("/api/workspace");
    const data = await res.json();
    expect(data.sessions).toHaveLength(1);
    expect(data.sessions[0].title).toBe("Test session");
  });
});

// ── Events ──

describe("GET /api/events", () => {
  it("returns events list", async () => {
    const res = await request("/api/events");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.events).toEqual([]);
  });

  it("validates afterGlobalSeq parameter", async () => {
    const res = await request("/api/events?afterGlobalSeq=-1");
    expect(res.status).toBe(400);
  });

  it("validates limit parameter", async () => {
    const res = await request("/api/events?limit=0");
    expect(res.status).toBe(400);
  });

  it("returns events after sending a message", async () => {
    const { sessionId } = (await (await postJson("/api/sessions", {})).json()) as any;
    await postJson(`/api/sessions/${sessionId}/messages`, { text: "Hello" });
    const res = await request("/api/events?limit=10");
    const data = await res.json();
    expect(data.events.length).toBeGreaterThan(0);
  });
});

// ── Sessions ──

describe("POST /api/sessions", () => {
  it("creates a session with defaults", async () => {
    const res = await postJson("/api/sessions", {});
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.sessionId).toMatch(/^ses_/);
    expect(data.workspace).toBeDefined();
    expect(data.workspace.sessions).toHaveLength(1);
  });

  it("creates a session with custom title and agent", async () => {
    const res = await postJson("/api/sessions", { title: "Custom", agentType: "claude" });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.workspace.sessions[0].name).toBe("Custom");
    expect(data.workspace.sessions[0].title).toBe("Custom");
    expect(data.workspace.sessions[0].agentType).toBe("claude");
  });

  it("renames a session", async () => {
    const { sessionId } = (await (await postJson("/api/sessions", {})).json()) as any;
    const res = await patchJson(`/api/sessions/${sessionId}`, { name: "Investigate sync issue" });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.workspace.sessions[0].name).toBe("Investigate sync issue");

    const store = new SessionStore(db, new EventStore(db));
    expect(store.getSession(sessionId)?.name).toBe("Investigate sync issue");
  });

  it("rejects invalid session names", async () => {
    const { sessionId } = (await (await postJson("/api/sessions", {})).json()) as any;
    expect((await patchJson(`/api/sessions/${sessionId}`, { name: "" })).status).toBe(400);
    expect((await patchJson(`/api/sessions/${sessionId}`, { name: 123 })).status).toBe(400);
    expect((await patchJson("/api/sessions/ses_missing", { name: "Missing" })).status).toBe(404);
  });

  it("rejects invalid agentType", async () => {
    const res = await postJson("/api/sessions", { agentType: "invalid" });
    expect(res.status).toBe(400);
  });

  it("rejects non-string title", async () => {
    const res = await postJson("/api/sessions", { title: 123 });
    expect(res.status).toBe(400);
  });

  it("rejects disallowed workspace path", async () => {
    const res = await postJson("/api/sessions", { workspacePath: "/etc/passwd" });
    expect(res.status).toBe(403);
  });
});

// ── Messages ──

describe("POST /api/sessions/:sessionId/messages", () => {
  it("sends a message to a session", async () => {
    const { sessionId } = (await (await postJson("/api/sessions", {})).json()) as any;
    const res = await postJson(`/api/sessions/${sessionId}/messages`, { text: "Hello agent" });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.taskId).toMatch(/^tsk_/);
    expect(data.workspace).toBeDefined();
  });

  it("rejects empty text", async () => {
    const { sessionId } = (await (await postJson("/api/sessions", {})).json()) as any;
    const res = await postJson(`/api/sessions/${sessionId}/messages`, { text: "" });
    expect(res.status).toBe(400);
  });

  it("rejects missing text", async () => {
    const { sessionId } = (await (await postJson("/api/sessions", {})).json()) as any;
    const res = await postJson(`/api/sessions/${sessionId}/messages`, {});
    expect(res.status).toBe(400);
  });

  it("creates session for unknown chatId (web auto-creates)", async () => {
    const res = await postJson("/api/sessions/ses_nonexistent/messages", { text: "hi" });
    expect(res.status).toBe(201); // InboundService creates a new session for web
  });
});

// ── Runs ──

describe("POST /api/sessions/:sessionId/runs/start", () => {
  it("returns 404 for unknown session", async () => {
    const res = await postJson("/api/sessions/ses_nonexistent/runs/start", {});
    expect(res.status).toBe(404);
  });

  it("returns 409 when no queued task", async () => {
    const { sessionId } = (await (await postJson("/api/sessions", {})).json()) as any;
    const res = await postJson(`/api/sessions/${sessionId}/runs/start`, {});
    expect(res.status).toBe(409);
  });
});

describe("POST /api/runs/:runId/stop", () => {
  it("returns 404 for unknown run", async () => {
    const res = await postJson("/api/runs/run_nonexistent/stop", {});
    expect(res.status).toBe(404);
  });
});

// ── Permissions ──

describe("GET /api/runs/:runId/permissions", () => {
  it("returns empty list for unknown run", async () => {
    const res = await request("/api/runs/run_nonexistent/permissions");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.permissions).toEqual([]);
  });
});

describe("POST /api/runs/:runId/permissions/:requestId/respond", () => {
  it("rejects invalid outcome", async () => {
    const res = await postJson("/api/runs/run_1/permissions/prm_1/respond", { outcome: "maybe" });
    expect(res.status).toBe(400);
  });
});

// ── Context ──

describe("POST /api/sessions/:sessionId/context/compact", () => {
  it("compacts session context", async () => {
    const { sessionId } = (await (await postJson("/api/sessions", {})).json()) as any;
    const res = await postJson(`/api/sessions/${sessionId}/context/compact`, {});
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.contextPackId).toMatch(/^ctx_/);
    expect(data.contextBudget).toBeDefined();
    expect(data.workspace).toBeDefined();
  });

  it("returns 404 for unknown session", async () => {
    const res = await postJson("/api/sessions/ses_nonexistent/context/compact", {});
    expect(res.status).toBe(404);
  });

  it("rejects invalid budgetTokens", async () => {
    const { sessionId } = (await (await postJson("/api/sessions", {})).json()) as any;
    const res = await postJson(`/api/sessions/${sessionId}/context/compact`, { budgetTokens: -1 });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/sessions/:sessionId/context/restart", () => {
  it("restarts session context", async () => {
    const { sessionId } = (await (await postJson("/api/sessions", {})).json()) as any;
    await postJson(`/api/sessions/${sessionId}/context/compact`, {});
    const res = await postJson(`/api/sessions/${sessionId}/context/restart`, {});
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.taskId).toMatch(/^tsk_/);
    expect(data.workspace).toBeDefined();
  });

  it("returns 404 for unknown session", async () => {
    const res = await postJson("/api/sessions/ses_nonexistent/context/restart", {});
    expect(res.status).toBe(404);
  });
});

// ── Handoffs ──

describe("POST /api/sessions/:sessionId/handoffs", () => {
  it("creates a handoff to another agent", async () => {
    const { sessionId } = (await (await postJson("/api/sessions", {})).json()) as any;
    const res = await postJson(`/api/sessions/${sessionId}/handoffs`, { targetAgentType: "claude" });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.targetSessionId).toMatch(/^ses_/);
    expect(data.targetSessionId).not.toBe(sessionId);
    expect(data.workspace).toBeDefined();
  });

  it("rejects invalid targetAgentType", async () => {
    const { sessionId } = (await (await postJson("/api/sessions", {})).json()) as any;
    const res = await postJson(`/api/sessions/${sessionId}/handoffs`, { targetAgentType: "invalid" });
    expect(res.status).toBe(400);
  });

  it("returns 404 for unknown session", async () => {
    const res = await postJson("/api/sessions/ses_nonexistent/handoffs", { targetAgentType: "claude" });
    expect(res.status).toBe(404);
  });
});

// ── Agents ──

describe("GET /api/agents", () => {
  it("returns agent list", async () => {
    const res = await request("/api/agents");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.agents).toBeInstanceOf(Array);
  });
});

// ── Agent Defaults ──

describe("GET /api/agent-defaults/resolve", () => {
  it("returns 404 when no default set", async () => {
    const res = await request("/api/agent-defaults/resolve?workspacePath=/tmp");
    expect(res.status).toBe(404);
  });
});

describe("POST /api/agent-defaults", () => {
  it("sets a default agent", async () => {
    const res = await postJson("/api/agent-defaults", {
      scopeType: "workspace",
      scopeRef: "/tmp",
      agentType: "claude",
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.default.agentType).toBe("claude");
    expect(data.default.scopeType).toBe("workspace");
  });

  it("rejects invalid scopeType", async () => {
    const res = await postJson("/api/agent-defaults", {
      scopeType: "invalid",
      scopeRef: "/tmp",
      agentType: "claude",
    });
    expect(res.status).toBe(400);
  });

  it("rejects missing scopeRef", async () => {
    const res = await postJson("/api/agent-defaults", {
      scopeType: "workspace",
      agentType: "claude",
    });
    expect(res.status).toBe(400);
  });

  it("resolves previously set default", async () => {
    await postJson("/api/agent-defaults", {
      scopeType: "workspace",
      scopeRef: "/my-workspace",
      agentType: "codex",
    });
    const res = await request("/api/agent-defaults/resolve?workspacePath=/my-workspace");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.default.agentType).toBe("codex");
  });
});

// ── Channels ──

describe("GET /api/channels", () => {
  it("returns channel list", async () => {
    const res = await request("/api/channels");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.channels).toBeInstanceOf(Array);
    const web = data.channels.find((c: any) => c.id === "web");
    expect(web).toBeDefined();
    expect(web.status).toBe("connected");
  });
});

describe("PUT /api/channels/:channelId/config", () => {
  it("updates channel config", async () => {
    const res = await putJson("/api/channels/feishu/config", {
      app_id: "test_app_id",
      app_secret: "test_secret",
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.config.app_id).toBe("test_app_id");
    expect(data.channelStart).toEqual({ ok: true, message: "Started" });
  });

  it("returns start errors for fully configured channels", async () => {
    channelRegistry.startChannel = async () => ({ ok: false, message: "invalid token" });

    const res = await putJson("/api/channels/telegram/config", {
      bot_token: "bad-token",
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("invalid token");
  });

  it("does not start channels until required config is present", async () => {
    let started = false;
    channelRegistry.startChannel = async () => {
      started = true;
      return { ok: true, message: "Started" };
    };

    const res = await putJson("/api/channels/feishu/config", {
      app_id: "test_app_id",
    });

    expect(res.status).toBe(200);
    expect(started).toBe(false);
  });

  it("rejects non-object body", async () => {
    const res = await request("/api/channels/feishu/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    expect(res.status).toBe(400);
  });
});

// ── Schedules ──

describe("GET /api/schedules", () => {
  it("returns 400 when sessionId missing", async () => {
    const res = await request("/api/schedules");
    expect(res.status).toBe(400);
  });

  it("returns empty list for session", async () => {
    const { sessionId } = (await (await postJson("/api/sessions", {})).json()) as any;
    const res = await request(`/api/schedules?sessionId=${sessionId}`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.schedules).toEqual([]);
  });
});

describe("POST /api/schedules", () => {
  it("creates a cron schedule", async () => {
    const { sessionId } = (await (await postJson("/api/sessions", {})).json()) as any;
    const res = await postJson("/api/schedules", {
      sessionId,
      kind: "cron",
      cronExpr: "0 9 * * 1-5",
      timezone: "UTC",
      payload: { text: "Daily summary" },
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.schedule.id).toMatch(/^sch_/);
    expect(data.schedule.kind).toBe("cron");
    expect(data.schedule.cronExpr).toBe("0 9 * * 1-5");
    expect(data.schedule.timezone).toBe("UTC");
    expect(data.schedule.payloadText).toBe("Daily summary");
    expect(data.schedule.payloadSummary).toBe("Daily summary");
    expect(data.schedule.nextRunAt).toBeTruthy();
  });

  it("creates a once schedule", async () => {
    const { sessionId } = (await (await postJson("/api/sessions", {})).json()) as any;
    const res = await postJson("/api/schedules", {
      sessionId,
      kind: "once",
      runAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.schedule.kind).toBe("once");
  });

  it("rejects invalid kind", async () => {
    const { sessionId } = (await (await postJson("/api/sessions", {})).json()) as any;
    const res = await postJson("/api/schedules", { sessionId, kind: "invalid" });
    expect(res.status).toBe(400);
  });

  it("rejects missing sessionId", async () => {
    const res = await postJson("/api/schedules", { kind: "cron", cronExpr: "* * * * *" });
    expect(res.status).toBe(400);
  });

  it("rejects unknown session", async () => {
    const res = await postJson("/api/schedules", { sessionId: "ses_nonexistent", kind: "cron" });
    expect(res.status).toBe(404);
  });

  it("rejects invalid schedule details", async () => {
    const { sessionId } = (await (await postJson("/api/sessions", {})).json()) as any;
    expect((await postJson("/api/schedules", { sessionId, kind: "cron", cronExpr: "bad" })).status).toBe(400);
    expect((await postJson("/api/schedules", { sessionId, kind: "cron", cronExpr: "0,,5 * * * *" })).status).toBe(400);
    expect((await postJson("/api/schedules", { sessionId, kind: "cron", cronExpr: "* * * * *", timezone: "Mars/Base" })).status).toBe(400);
    expect((await postJson("/api/schedules", { sessionId, kind: "once" })).status).toBe(400);
    expect((await postJson("/api/schedules", { sessionId, kind: "once", runAt: "nope" })).status).toBe(400);
  });
});

describe("PATCH /api/schedules/:scheduleId", () => {
  it("updates schedule details and payload", async () => {
    const { sessionId } = (await (await postJson("/api/sessions", {})).json()) as any;
    const { schedule } = await (await postJson("/api/schedules", {
      sessionId,
      kind: "cron",
      cronExpr: "0 9 * * *",
      timezone: "Asia/Shanghai",
      payload: { text: "old message" },
    })).json() as any;

    const res = await patchJson(`/api/schedules/${schedule.id}`, {
      kind: "cron",
      cronExpr: "15 10 * * 1-5",
      timezone: "UTC",
      payload: { text: "updated message" },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.schedule.cronExpr).toBe("15 10 * * 1-5");
    expect(data.schedule.timezone).toBe("UTC");
    expect(data.schedule.payloadText).toBe("updated message");
    expect(data.schedule.payloadSummary).toBe("updated message");
    expect(data.schedule.nextRunAt).toBeTruthy();
  });

  it("rejects updates to cancelled schedules", async () => {
    const { sessionId } = (await (await postJson("/api/sessions", {})).json()) as any;
    const { schedule } = await (await postJson("/api/schedules", {
      sessionId,
      kind: "once",
      runAt: new Date(Date.now() + 3600_000).toISOString(),
      payload: { text: "soon" },
    })).json() as any;
    await postJson(`/api/schedules/${schedule.id}/cancel`, {});

    const res = await patchJson(`/api/schedules/${schedule.id}`, {
      kind: "once",
      runAt: new Date(Date.now() + 7200_000).toISOString(),
      payload: { text: "later" },
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/schedules/preview", () => {
  it("returns the next cron run for the selected timezone", async () => {
    const res = await postJson("/api/schedules/preview", {
      kind: "cron",
      cronExpr: "0 9 * * 1-5",
      timezone: "UTC",
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.nextRunAt).toBeTruthy();
    expect(data.timezone).toBe("UTC");
  });

  it("rejects invalid cron preview input", async () => {
    const res = await postJson("/api/schedules/preview", {
      kind: "cron",
      cronExpr: "bad",
      timezone: "Mars/Base",
    });
    expect(res.status).toBe(400);

    const onceRes = await postJson("/api/schedules/preview", {
      kind: "once",
      runAt: new Date(Date.now() + 3600_000).toISOString(),
      timezone: "Mars/Base",
    });
    expect(onceRes.status).toBe(400);
  });
});

describe("POST /api/schedules/due/run", () => {
  it("runs due schedules", async () => {
    const { sessionId } = (await (await postJson("/api/sessions", {})).json()) as any;
    // Create a schedule that's already due
    const created = await postJson("/api/schedules", {
      sessionId,
      kind: "once",
      runAt: new Date(Date.now() - 1000).toISOString(),
      payload: { text: "history payload summary" },
    });
    const { schedule } = await created.json() as any;

    const res = await postJson("/api/schedules/due/run", {});
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.triggered).toBeInstanceOf(Array);
    expect(data.triggered.length).toBeGreaterThanOrEqual(1);
    expect(data.triggered[0].taskId).toMatch(/^tsk_/);
    expect(data.triggered[0].schedule.sessionId).toBe(sessionId);
    expect(data.triggered[0].schedule.status).toBe("cancelled");

    const runsRes = await request(`/api/schedules/${schedule.id}/runs`);
    expect(runsRes.status).toBe(200);
    const runsData = await runsRes.json();
    expect(runsData.runs).toHaveLength(1);
    expect(runsData.runs[0].taskId).toBe(data.triggered[0].taskId);
    expect(runsData.runs[0].status).toBe("running");
    expect(runsData.runs[0].payloadSummary).toBe("history payload summary");
  });
});

describe("Schedule status updates (pause/resume/cancel)", () => {
  it("pauses a schedule", async () => {
    const { sessionId } = (await (await postJson("/api/sessions", {})).json()) as any;
    const { schedule } = await (await postJson("/api/schedules", {
      sessionId,
      kind: "cron",
      cronExpr: "0 9 * * *",
    })).json() as any;

    const res = await postJson(`/api/schedules/${schedule.id}/pause`, {});
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.schedule.status).toBe("paused");
  });

  it("resumes a paused schedule", async () => {
    const { sessionId } = (await (await postJson("/api/sessions", {})).json()) as any;
    const { schedule } = await (await postJson("/api/schedules", {
      sessionId,
      kind: "cron",
      cronExpr: "0 9 * * *",
    })).json() as any;

    await postJson(`/api/schedules/${schedule.id}/pause`, {});
    const res = await postJson(`/api/schedules/${schedule.id}/resume`, {});
    expect(res.status).toBe(200);
    expect((await res.json()).schedule.status).toBe("active");
  });

  it("cancels a schedule", async () => {
    const { sessionId } = (await (await postJson("/api/sessions", {})).json()) as any;
    const { schedule } = await (await postJson("/api/schedules", {
      sessionId,
      kind: "cron",
      cronExpr: "0 9 * * *",
    })).json() as any;

    const res = await postJson(`/api/schedules/${schedule.id}/cancel`, {});
    expect(res.status).toBe(200);
    expect((await res.json()).schedule.status).toBe("cancelled");
  });
});

// ── Skills ──

describe("GET /api/skills", () => {
  it("returns skills list", async () => {
    const res = await request("/api/skills");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.skills).toBeInstanceOf(Array);
  });
});

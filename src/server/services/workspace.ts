import type { SqliteDatabase } from "../db/migrate.js";
import { SessionStore } from "../stores/session-store.js";
import { MessageStore } from "../stores/message-store.js";
import { EventStore } from "../stores/event-store.js";
import { ContextBudgetStore } from "../stores/context-budget-store.js";
import type { RuntimeSupervisor } from "../runtime/supervisor.js";
import type { WorkspaceSnapshot, WorkspaceSessionSummary, WorkspaceMessage, WorkspaceRunStats, WorkspaceContextBudget, WorkspaceRuntimeSummary } from "../../shared/workspace.js";

export class WorkspaceService {
  private sessions: SessionStore;
  private messages: MessageStore;
  private events: EventStore;
  private contextBudgets: ContextBudgetStore;

  constructor(
    private readonly db: SqliteDatabase,
    private readonly supervisor?: RuntimeSupervisor,
  ) {
    this.events = new EventStore(db);
    this.sessions = new SessionStore(db, this.events);
    this.messages = new MessageStore(db);
    this.contextBudgets = new ContextBudgetStore(db);
  }

  getSnapshot(selectedSessionId?: string | null): WorkspaceSnapshot {
    const { sessions } = this.sessions.listSessionsFiltered({ excludeCronOnly: true, limit: 50 });
    // Fallback must skip sessions bound to an active schedule: cron runs refresh
    // their updated_at daily, so they monopolize sessions[0] and get wrongly
    // picked as the default when no session is explicitly chosen (ISSUE-009).
    const scheduledSessionIds = this.getActiveScheduleSessionIds();
    const fallbackPool = scheduledSessionIds.size
      ? sessions.filter((s) => !scheduledSessionIds.has(s.id))
      : sessions;
    const sessionId = selectedSessionId ?? fallbackPool[0]?.id ?? sessions[0]?.id ?? null;
    const firstUserMessages = this.getFirstUserMessages(sessions.map((session) => session.id));

    const sessionSummaries: WorkspaceSessionSummary[] = sessions.map((s) => ({
      id: s.id,
      name: getSessionName(s.name, s.title, s.agentType, firstUserMessages.get(s.id)),
      title: s.title,
      agentType: s.agentType as any,
      agent: (s.agentType.charAt(0).toUpperCase() + s.agentType.slice(1)) as any,
      initials: s.agentType.slice(0, 2).toUpperCase(),
      workspace: s.workspacePath,
      channelType: s.channelType as any,
      status: this.mapSessionStatus(s.status),
      updatedAt: s.updatedAt,
      handoff: undefined,
    }));

    let messages: WorkspaceMessage[] = [];
    let runStats: WorkspaceRunStats = { durationSeconds: null, tokensUsed: null, tokensTotal: null };
    let outboxRows: Array<[string, string, string]> = [];
    let keyEvents: Array<[string, string, string]> = [];

    if (sessionId) {
      const msgs = this.messages.getLatestBySession(sessionId, 1000);
      messages = msgs.map((m) => ({
        id: m.id,
        runId: m.runId,
        role: this.mapRole(m.role),
        author: m.role === "user" ? "You" : m.role === "assistant" ? "Agent" : m.role,
        time: m.createdAt,
        createdAt: m.createdAt,
        badge: undefined,
        markdown: m.content,
      }));

      // Get run stats from latest run
      const latestRun = this.getLatestRun(sessionId);
      if (latestRun) {
        const firstSeq = latestRun.first_global_seq || latestRun.firstGlobalSeq || 0;
        const events = this.events.listAfterGlobalSeq({ sessionId, afterGlobalSeq: firstSeq - 1, limit: 500 });
        const textDeltas = events.filter((e) => e.type === "text_delta");
        let tokensUsed = 0;
        for (const e of textDeltas) {
          const p = e.payload as { tokenEstimate?: number };
          tokensUsed += p.tokenEstimate ?? 0;
        }
        const startedAt = latestRun.started_at ?? latestRun.startedAt;
        const stoppedAt = latestRun.stopped_at ?? latestRun.stoppedAt;
        const duration = startedAt && stoppedAt
          ? Math.round((new Date(stoppedAt).getTime() - new Date(startedAt).getTime()) / 1000)
          : null;
        runStats = { durationSeconds: duration, tokensUsed: tokensUsed || null, tokensTotal: null };
      }
    }

    const budget = sessionId ? this.contextBudgets.get(sessionId) : null;
    const contextBudget: WorkspaceContextBudget = {
      status: budget?.status ?? "healthy",
      tokenEstimate: budget?.tokenEstimate ?? 0,
      budgetTokens: budget?.budgetTokens ?? 200_000,
      usagePercent: budget ? Math.round(budget.usageRatio * 100) : 0,
      warningPercent: Math.round((budget?.warningThreshold ?? 0.70) * 100),
      criticalPercent: Math.round((budget?.criticalThreshold ?? 0.85) * 100),
      overflowPercent: Math.round((budget?.overflowThreshold ?? 0.95) * 100),
      currentContextPackId: budget?.currentContextPackId ?? null,
      lastCompactedAt: budget?.lastCompactedAt ?? null,
    };

    const activeRun = this.supervisor?.getActiveRunBySession(sessionId ?? "");
    const runtime: WorkspaceRuntimeSummary = {
      activeRunId: activeRun?.runId ?? null,
      status: activeRun ? "running" : "idle",
      pid: activeRun?.pid ?? null,
      agentType: null,
      runtimeKind: null,
      startedAt: null,
    };

    return {
      selectedSessionId: sessionId,
      sessions: sessionSummaries,
      messages,
      runStats,
      outboxRows,
      keyEvents,
      contextBudget,
      runtime,
    };
  }

  getSessionSummaries(options: {
    page?: number;
    limit?: number;
  } = {}): { sessions: WorkspaceSessionSummary[]; total: number; page: number; hasMore: boolean } {
    const page = options.page ?? 1;
    const limit = options.limit ?? 50;
    const offset = (page - 1) * limit;
    const { sessions, total } = this.sessions.listSessionsFiltered({ excludeCronOnly: true, limit, offset });
    const firstUserMessages = this.getFirstUserMessages(sessions.map((s) => s.id));

    const sessionSummaries: WorkspaceSessionSummary[] = sessions.map((s) => ({
      id: s.id,
      name: getSessionName(s.name, s.title, s.agentType, firstUserMessages.get(s.id)),
      title: s.title,
      agentType: s.agentType as any,
      agent: (s.agentType.charAt(0).toUpperCase() + s.agentType.slice(1)) as any,
      initials: s.agentType.slice(0, 2).toUpperCase(),
      workspace: s.workspacePath,
      channelType: s.channelType as any,
      status: this.mapSessionStatus(s.status),
      updatedAt: s.updatedAt,
      handoff: undefined,
    }));

    return {
      sessions: sessionSummaries,
      total,
      page,
      hasMore: offset + sessions.length < total,
    };
  }

  private getLatestRun(sessionId: string) {
    const rows = this.db.prepare(
      "SELECT * FROM agent_runs WHERE session_id = ? ORDER BY created_at DESC LIMIT 1"
    ).all(sessionId) as any[];
    return rows[0] ?? null;
  }

  private getActiveScheduleSessionIds(): Set<string> {
    const rows = this.db.prepare(
      "SELECT DISTINCT session_id FROM schedules WHERE status = 'active'"
    ).all() as Array<{ session_id: string }>;
    return new Set(rows.map((row) => row.session_id));
  }

  private getFirstUserMessages(sessionIds: string[]): Map<string, string> {
    if (sessionIds.length === 0) return new Map();

    const placeholders = sessionIds.map(() => "?").join(",");
    const rows = this.db.prepare(
      `SELECT session_id, content
       FROM (
         SELECT session_id, content,
           row_number() OVER (PARTITION BY session_id ORDER BY created_at ASC, id ASC) AS row_num
         FROM messages
         WHERE role = 'user' AND session_id IN (${placeholders})
       )
       WHERE row_num = 1`
    ).all(...sessionIds) as Array<{ session_id: string; content: string }>;

    return new Map(rows.map((row) => [row.session_id, row.content]));
  }

  private mapSessionStatus(status: string): any {
    if (status === "idle") return "idle";
    if (status === "running") return "running";
    if (status === "compacting") return "compact";
    return status as any;
  }

  private mapRole(role: string): "user" | "agent" | "tool" | "system" {
    if (role === "assistant") return "agent";
    if (role === "user" || role === "system" || role === "tool") return role;
    return "system";
  }
}

function getSessionName(persistedName: string, title: string, agentType: string, firstUserMessage?: string): string {
  const cleanPersistedName = normalizeLabel(persistedName);
  const cleanTitle = normalizeLabel(title);
  const cleanMessage = normalizeLabel(firstUserMessage ?? "");

  if (cleanPersistedName) return cleanPersistedName;
  if (cleanTitle && cleanTitle !== `${getAgentLabel(agentType)} session`) {
    return cleanTitle;
  }

  return cleanMessage || cleanTitle || "Untitled";
}

function getAgentLabel(agentType: string): string {
  return agentType.charAt(0).toUpperCase() + agentType.slice(1);
}

function normalizeLabel(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

import type { SqliteDatabase } from "../db/migrate.js";
import { SessionStore, type SessionRecord, type SourceType } from "../stores/session-store.js";
import { EventStore } from "../stores/event-store.js";
import { MessageStore } from "../stores/message-store.js";
import { OutboxStore, type OutboxChannel, type OutboxKind } from "../stores/outbox-store.js";
import { AuditLogStore, type AuditActorType } from "../stores/audit-log-store.js";
import { AgentDefaultStore } from "../stores/agent-default-store.js";
import { ContextBudgetStore } from "../stores/context-budget-store.js";
import { DelegationStore } from "../stores/delegation-store.js";
import { GoalStore, type GoalRecord } from "../stores/goal-store.js";
import { ScheduleStore, summarizeSchedulePayload } from "../stores/schedule-store.js";
import { WorkspacePolicy, WorkspacePolicyError } from "../security/workspace-policy.js";
import { MemoryService } from "./memory.js";
import { SchedulerService } from "./scheduler.js";
import { SkillService } from "./skills.js";
import { createId } from "../../shared/ids.js";

export type InboundMessage = {
  messageId: string;
  chatId: string;
  userId: string;
  text: string;
  chatType: "private" | "group";
  isMentioned?: boolean;
  providerMessageId?: string;
};

export type InboundResult = {
  action: "message" | "command" | "ignored";
  session: SessionRecord;
  taskId?: string;
};

const SLASH_COMMANDS = ["/agent", "/context", "/cron", "/goal", "/delegate", "/skill", "/search"] as const;

export class InboundService {
  private sessions: SessionStore;
  private events: EventStore;
  private messages: MessageStore;
  private outbox: OutboxStore;
  private auditLogs: AuditLogStore;
  private agentDefaults: AgentDefaultStore;
  private contextBudgets: ContextBudgetStore;
  private delegations: DelegationStore;
  private goals: GoalStore;
  private schedules: ScheduleStore;
  private schedulerService: SchedulerService;
  private memory: MemoryService;
  private skills: SkillService;

  constructor(
    private readonly db: SqliteDatabase,
    private readonly channelType: string,
    private readonly options: { workspacePolicy: WorkspacePolicy },
  ) {
    this.events = new EventStore(db);
    this.sessions = new SessionStore(db, this.events);
    this.messages = new MessageStore(db);
    this.outbox = new OutboxStore(db);
    this.auditLogs = new AuditLogStore(db);
    this.agentDefaults = new AgentDefaultStore(db);
    this.contextBudgets = new ContextBudgetStore(db);
    this.delegations = new DelegationStore(db);
    this.goals = new GoalStore(db);
    this.schedules = new ScheduleStore(db);
    this.schedulerService = new SchedulerService(db);
    this.memory = new MemoryService(db);
    this.skills = new SkillService();
  }

  receiveMessage(msg: InboundMessage): InboundResult {
    const trimmed = msg.text.trim();
    if (!trimmed) return { action: "ignored", session: this.getOrCreateSession(msg) };

    // Group mention gating: skip group messages that don't mention the bot
    if (msg.chatType === "group" && msg.isMentioned === false) {
      return { action: "ignored", session: this.getOrCreateSession(msg) };
    }

    // Check slash commands
    const slashCmd = SLASH_COMMANDS.find((cmd) => trimmed.toLowerCase().startsWith(cmd));
    if (slashCmd) {
      return this.handleSlashCommand(msg, trimmed);
    }

    return this.handleUserMessage(msg, trimmed);
  }

  receiveOnSession(
    session: SessionRecord,
    msg: { messageId: string; userId: string; text: string; providerMessageId?: string },
  ): InboundResult {
    const trimmed = msg.text.trim();
    if (!trimmed) return { action: "ignored", session };

    const sourceType = this.channelType as SourceType;
    const dedupeKey = `${this.channelType}:${msg.messageId}`;
    const actorType = mapChannelActorType(this.channelType);

    const { task, event } = this.sessions.createTask({
      sessionId: session.id,
      sourceType,
      sourceRef: msg.userId,
      type: "message",
      input: { text: trimmed, userId: msg.userId },
      dedupeKey,
    });

    this.messages.insert({
      sessionId: session.id,
      role: "user",
      content: trimmed,
      metadata: { userId: msg.userId, sourceType, messageId: msg.messageId, ...(msg.providerMessageId ? { providerMessageId: msg.providerMessageId } : {}) },
      sourceEventId: event.id,
    });
    this.persistInitialSessionName(session.id);

    this.auditLogs.insert({
      actorType,
      actorRef: msg.userId,
      action: "message_received",
      resourceType: "task",
      resourceId: task.id,
      payload: { text: trimmed.slice(0, 200), channelType: this.channelType },
    });

    return { action: "message", session, taskId: task.id };
  }

  private handleUserMessage(msg: InboundMessage, text: string): InboundResult {
    const session = this.getOrCreateSession(msg);
    const decision = this.options.workspacePolicy.evaluate(session.workspacePath);
    if (!decision.allowed) {
      const fallback = this.options.workspacePolicy.defaultWorkspace;
      if (!fallback) throw new WorkspacePolicyError(session.workspacePath, decision.normalizedPath, decision.allowlist, decision.reason);
      console.warn(`[Inbound] Session ${session.id} workspace "${session.workspacePath}" denied, auto-fixing to "${fallback}"`);
      this.sessions.updateWorkspacePath(session.id, fallback);
      session.workspacePath = fallback;
    }

    const sourceType = this.channelType as SourceType;
    const dedupeKey = `${this.channelType}:${msg.messageId}`;
    const actorType = mapChannelActorType(this.channelType);

    const { task, event } = this.sessions.createTask({
      sessionId: session.id,
      sourceType,
      sourceRef: msg.userId,
      type: "message",
      input: { text, userId: msg.userId, chatId: msg.chatId },
      dedupeKey,
    });

    // Write message directly (no projector)
    this.messages.insert({
      sessionId: session.id,
      role: "user",
      content: text,
      metadata: { userId: msg.userId, sourceType, messageId: msg.messageId, ...(msg.providerMessageId ? { providerMessageId: msg.providerMessageId } : {}) },
      sourceEventId: event.id,
    });
    this.persistInitialSessionName(session.id);

    // Enqueue outbox for non-web channels (web uses SSE directly)
    if (this.channelType !== "web") {
      // Will be enqueued after run finishes by delivery service
    }

    this.auditLogs.insert({
      actorType,
      actorRef: msg.userId,
      action: "message_received",
      resourceType: "task",
      resourceId: task.id,
      payload: { text: text.slice(0, 200), channelType: this.channelType },
    });

    return { action: "message", session, taskId: task.id };
  }

  private handleSlashCommand(msg: InboundMessage, text: string): InboundResult {
    const session = this.getOrCreateSession(msg);
    const parts = text.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const actorType = mapChannelActorType(this.channelType);

    if (cmd === "/agent") {
      const sub = parts[1]?.toLowerCase();
      if (sub === "list") {
        // Respond with agent list via outbox
        this.enqueueTextReply(session, "Available agents: claude, codex, trae\nUse /agent use <type> to switch.");
        return { action: "command", session };
      }
      if (sub === "use" && parts[2]) {
        const agentType = parts[2].toLowerCase();
        this.agentDefaults.set({
          scopeType: "channel",
          scopeRef: `${this.channelType}:${msg.chatId}`,
          agentType,
        });
        this.auditLogs.insert({ actorType, actorRef: msg.userId, action: "agent_switched", resourceType: "session", resourceId: session.id, payload: { agentType } });
        this.enqueueTextReply(session, `Default agent set to ${agentType} for this channel.`);
        return { action: "command", session };
      }
      if (sub === "new") {
        const agentType = parts[2]?.toLowerCase();
        const newSession = this.sessions.createSession({
          title: agentType ? `New ${agentType} session` : "New session",
          agentType: agentType ?? session.agentType,
          workspacePath: session.workspacePath,
          channelType: this.channelType as any,
          channelRef: msg.chatId,
        });
        this.enqueueTextReply(newSession, `New session created: ${newSession.id}`);
        return { action: "command", session: newSession };
      }
      this.enqueueTextReply(session, "Usage:\n/agent list — show agents\n/agent use <type> — set default\n/agent new [type] — new session");
      return { action: "command", session };
    }

    if (cmd === "/context") {
      const sub = parts[1]?.toLowerCase();
      if (sub === "status") {
        const budget = this.contextBudgets.get(session.id);
        if (budget) {
          const pct = Math.round(budget.usageRatio * 100);
          this.enqueueTextReply(session, `Context: ${pct}% used (${budget.status})\nEstimate: ~${budget.tokenEstimate.toLocaleString()} / ${budget.budgetTokens.toLocaleString()} tokens`);
        } else {
          this.enqueueTextReply(session, "Context: healthy (no budget data yet)");
        }
        return { action: "command", session };
      }
      this.enqueueTextReply(session, "Usage:\n/context status — show context budget");
      return { action: "command", session };
    }

    if (cmd === "/cron") {
      return this.handleCronCommand(session, msg, parts, text);
    }

    if (cmd === "/goal") {
      return this.handleGoalCommand(session, msg, parts, text);
    }

    if (cmd === "/delegate") {
      return this.handleDelegateCommand(session, msg, text);
    }

    if (cmd === "/skill") {
      return this.handleSkillCommand(session, msg, parts, text);
    }

    if (cmd === "/search") {
      const query = text.replace(/^\/search\s*/i, "").trim();
      if (!query) {
        this.enqueueTextReply(session, "Usage: /search <keyword>");
        return { action: "command", session };
      }
      const results = this.memory.search(query, { sessionId: session.id, limit: 5 });
      this.enqueueTextReply(session, this.memory.formatResults(results));
      return { action: "command", session };
    }

    return { action: "ignored", session };
  }

  private handleCronCommand(session: SessionRecord, msg: InboundMessage, parts: string[], text: string): InboundResult {
    const sub = parts[1]?.toLowerCase();
    if (sub === "list") {
      const schedules = this.schedules.listBySession(session.id);
      if (schedules.length === 0) {
        this.enqueueTextReply(session, "No schedules for this session.");
      } else {
        this.enqueueTextReply(session, schedules.map((schedule) => {
          const timing = schedule.kind === "cron" ? schedule.cronExpr : schedule.runAt;
          return `${schedule.id} ${schedule.status} ${schedule.kind} ${timing ?? ""}\n${summarizeSchedulePayload(schedule.payload) ?? ""}`;
        }).join("\n\n"));
      }
      return { action: "command", session };
    }

    if ((sub === "pause" || sub === "resume" || sub === "cancel") && parts[2]) {
      const updated =
        sub === "pause" ? this.schedules.updateStatus(parts[2], "paused") :
        sub === "resume" ? this.schedules.updateStatus(parts[2], "active") :
        this.schedules.updateStatus(parts[2], "cancelled");
      this.enqueueTextReply(session, updated ? `Schedule ${updated.id} is now ${updated.status}.` : "Schedule not found.");
      return { action: "command", session };
    }

    if (sub === "add") {
      const rest = text.replace(/^\/cron\s+add\s+/i, "").trim();
      const parsed = parseCronAdd(rest);
      if (!parsed) {
        this.enqueueTextReply(session, "Usage: /cron add <5-field cron> <prompt>");
        return { action: "command", session };
      }
      const schedule = this.schedulerService.create({
        sessionId: session.id,
        kind: "cron",
        cronExpr: parsed.cronExpr,
        payload: { text: parsed.prompt },
        actorType: mapChannelActorType(this.channelType),
        actorRef: msg.userId,
      });
      this.enqueueTextReply(session, `Schedule created: ${schedule.id}\nNext run: ${schedule.nextRunAt}`);
      return { action: "command", session };
    }

    if (sub === "once") {
      const rest = text.replace(/^\/cron\s+once\s+/i, "").trim();
      const [runAt, ...promptParts] = rest.split(/\s+/);
      const prompt = promptParts.join(" ").trim();
      if (!runAt || !prompt) {
        this.enqueueTextReply(session, "Usage: /cron once <ISO time> <prompt>");
        return { action: "command", session };
      }
      const schedule = this.schedulerService.create({
        sessionId: session.id,
        kind: "once",
        runAt,
        payload: { text: prompt },
        actorType: mapChannelActorType(this.channelType),
        actorRef: msg.userId,
      });
      this.enqueueTextReply(session, `One-shot schedule created: ${schedule.id}\nRun at: ${schedule.runAt}`);
      return { action: "command", session };
    }

    this.enqueueTextReply(session, "Usage:\n/cron list\n/cron add <5-field cron> <prompt>\n/cron once <ISO time> <prompt>\n/cron pause|resume|cancel <scheduleId>");
    return { action: "command", session };
  }

  private handleGoalCommand(session: SessionRecord, msg: InboundMessage, parts: string[], text: string): InboundResult {
    const sub = parts[1]?.toLowerCase();
    if (!sub || !["status", "pause", "resume", "complete", "clear", "subgoal"].includes(sub)) {
      const objective = text.replace(/^\/goal\s*/i, "").trim();
      if (!objective) {
        this.enqueueTextReply(session, "Usage: /goal <objective>\n/goal status|pause|resume|complete|clear\n/goal subgoal <criterion>");
        return { action: "command", session };
      }
      const goal = this.goals.set({ sessionId: session.id, objective });
      this.auditLogs.insert({
        actorType: mapChannelActorType(this.channelType),
        actorRef: msg.userId,
        action: "goal_set",
        resourceType: "goal",
        resourceId: goal.id,
        payload: { sessionId: session.id },
      });
      this.enqueueTextReply(session, `Goal set: ${goal.objective}`);
      return { action: "command", session };
    }

    if (sub === "status") {
      const goal = this.goals.get(session.id);
      this.enqueueTextReply(session, goal ? formatGoal(goal) : "No goal is set for this session.");
      return { action: "command", session };
    }

    if (sub === "subgoal") {
      const subgoal = text.replace(/^\/goal\s+subgoal\s*/i, "").trim();
      if (!subgoal) {
        this.enqueueTextReply(session, "Usage: /goal subgoal <criterion>");
        return { action: "command", session };
      }
      const goal = this.goals.addSubgoal(session.id, subgoal);
      this.enqueueTextReply(session, goal ? `Subgoal added.\n${formatGoal(goal)}` : "No active goal is set.");
      return { action: "command", session };
    }

    const status = sub === "complete" ? "completed" : sub === "clear" ? "cleared" : sub === "pause" ? "paused" : "active";
    const goal = this.goals.updateStatus(session.id, status);
    this.enqueueTextReply(session, goal ? `Goal ${goal.status}.` : "No goal is set for this session.");
    return { action: "command", session };
  }

  private handleDelegateCommand(session: SessionRecord, msg: InboundMessage, text: string): InboundResult {
    const goal = text.replace(/^\/delegate\s*/i, "").trim();
    if (!goal) {
      this.enqueueTextReply(session, "Usage: /delegate <isolated task goal>");
      return { action: "command", session };
    }

    const child = this.sessions.createSession({
      title: `Delegated: ${goal.slice(0, 48)}`,
      agentType: session.agentType,
      workspacePath: session.workspacePath,
      channelType: session.channelType as any,
      channelRef: session.channelRef,
      sourceSessionId: session.id,
      defaultParams: { delegatedFrom: session.id },
    });
    const { task } = this.sessions.createTask({
      sessionId: child.id,
      sourceType: this.channelType as SourceType,
      sourceRef: msg.userId,
      type: "message",
      input: {
        text: `You are a delegated child agent. Work independently on this goal and report a concise final summary.\n\nGoal: ${goal}\n\nParent session: ${session.id}`,
        delegatedFrom: session.id,
      },
      dedupeKey: `${this.channelType}:delegate:${msg.messageId}`,
    });
    const delegation = this.delegations.create({
      parentSessionId: session.id,
      childSessionId: child.id,
      childTaskId: task.id,
      goal,
    });
    this.enqueueTextReply(session, `Delegated task created: ${delegation.id}\nChild session: ${child.id}`);
    return { action: "command", session: child, taskId: task.id };
  }

  private handleSkillCommand(session: SessionRecord, msg: InboundMessage, parts: string[], text: string): InboundResult {
    const sub = parts[1]?.toLowerCase();
    if (sub === "list") {
      const skills = this.skills.listSync().slice(0, 20);
      this.enqueueTextReply(session, skills.length ? skills.map((skill) => `/${skill.name} — ${skill.description || skill.source}`).join("\n") : "No skills found.");
      return { action: "command", session };
    }

    if (sub === "use" && parts[2]) {
      const skillName = parts[2];
      const prompt = text.replace(/^\/skill\s+use\s+\S+\s*/i, "").trim() || `Use skill /${skillName}.`;
      const { task } = this.sessions.createTask({
        sessionId: session.id,
        sourceType: this.channelType as SourceType,
        sourceRef: msg.userId,
        type: "message",
        input: { text: `Use skill /${skillName}.\n\n${prompt}`, skill: skillName },
        dedupeKey: `${this.channelType}:skill:${msg.messageId}`,
      });
      this.enqueueTextReply(session, `Queued skill task with /${skillName}.`);
      return { action: "command", session, taskId: task.id };
    }

    this.enqueueTextReply(session, "Usage:\n/skill list\n/skill use <name> [prompt]");
    return { action: "command", session };
  }

  private getOrCreateSession(msg: InboundMessage): SessionRecord {
    const existing = this.sessions.findSessionByChannel(this.channelType, msg.chatId);
    if (existing) return existing;

    // Resolve default agent
    const defaultAgent = this.agentDefaults.resolve({
      userRef: msg.userId,
      channelRef: `${this.channelType}:${msg.chatId}`,
    });

    return this.sessions.createSession({
      title: `Chat ${msg.chatId}`,
      agentType: defaultAgent?.agentType ?? "claude",
      workspacePath: process.cwd(),
      channelType: this.channelType as any,
      channelRef: msg.chatId,
    });
  }

  private enqueueTextReply(session: SessionRecord, text: string): void {
    const channelType = this.channelType as OutboxChannel;
    const kind = channelType === "web" ? "web_event" as OutboxKind : `${channelType}_markdown` as OutboxKind;
    this.outbox.enqueue({
      sessionId: session.id,
      channelType,
      targetRef: session.channelRef ?? "",
      kind,
      viewModel: { text },
      idempotencyKey: `reply:${session.id}:${createId("msg")}`,
    });
  }

  private persistInitialSessionName(sessionId: string): void {
    const firstUserMessage = this.messages.getFirstUserBySession(sessionId);
    if (!firstUserMessage) return;
    this.sessions.setSessionNameIfEmpty(sessionId, summarizeSessionName(firstUserMessage.content));
  }
}

function summarizeSessionName(text: string): string {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (normalized.length <= 160) return normalized;
  return `${normalized.slice(0, 157)}...`;
}

function parseCronAdd(input: string): { cronExpr: string; prompt: string } | null {
  const fields = input.trim().split(/\s+/);
  if (fields.length < 6) return null;
  const cronExpr = fields.slice(0, 5).join(" ");
  const prompt = fields.slice(5).join(" ").trim();
  return prompt ? { cronExpr, prompt } : null;
}

function formatGoal(goal: GoalRecord): string {
  const subgoals = goal.subgoals.length
    ? `\nSubgoals:\n${goal.subgoals.map((item, index) => `${index + 1}. ${item}`).join("\n")}`
    : "";
  return `Goal: ${goal.objective}\nStatus: ${goal.status}\nTurns: ${goal.turnCount}/${goal.maxTurns}${subgoals}`;
}

function mapChannelActorType(channelType: string): AuditActorType {
  if (channelType === "feishu") return "feishu_user";
  if (channelType === "qq") return "qq_user";
  if (channelType === "telegram") return "telegram_user";
  if (channelType === "discord") return "discord_user";
  return "web_user";
}

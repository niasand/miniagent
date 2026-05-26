import type { SqliteDatabase } from "../db/migrate.js";
import { SessionStore, type AgentRunRecord } from "../stores/session-store.js";
import { EventStore } from "../stores/event-store.js";
import { MessageStore } from "../stores/message-store.js";
import { PermissionRequestStore } from "../stores/permission-request-store.js";
import { OutboxStore, type OutboxChannel, type OutboxKind } from "../stores/outbox-store.js";
import { RuntimeAdapterRegistry } from "./registry.js";
import { TextDeltaBatcher } from "./text-delta-batcher.js";
import { ChildProcessFactory, type RuntimeProcess, type RuntimeProcessExit } from "./process.js";
import type {
  RuntimeSessionDriver, RuntimeRunHandle, RuntimeInput,
  RuntimeEventDraft, RuntimeDriverCallbacks, RuntimeErrorClassification,
  RuntimeLaunchContext, RuntimePermissionResponseInput,
} from "./types.js";
import { nowIso } from "../../shared/time.js";
import { estimateCost } from "../../shared/pricing.js";
import { createId } from "../../shared/ids.js";
import type { JsonObject, JsonValue } from "../../shared/json.js";

export type RuntimeSupervisorOptions = {
  db: SqliteDatabase;
  adapterRegistry?: RuntimeAdapterRegistry;
  processFactory?: typeof ChildProcessFactory;
  maxTextDeltaBytes?: number;
  cancelKillTimeoutMs?: number;
  outboxStore?: OutboxStore;
};

export type StartRuntimeTaskInput = {
  sessionId: string;
  taskId: string;
  agentType?: string;
};

export type StartedRuntimeRun = {
  run: AgentRunRecord;
  pid: number | null;
};

type ActiveRun = {
  runId: string;
  sessionId: string;
  taskId: string;
  driver: RuntimeSessionDriver;
  process: RuntimeProcess;
  handle: RuntimeRunHandle;
  batcher: TextDeltaBatcher;
  cancelTimer: ReturnType<typeof setTimeout> | null;
  inputTokens: number;
  outputTokens: number;
};

export class RuntimeSupervisor {
  private readonly db: SqliteDatabase;
  private readonly sessions: SessionStore;
  private readonly events: EventStore;
  private readonly messages: MessageStore;
  private readonly permissionRequests: PermissionRequestStore;
  private readonly adapterRegistry: RuntimeAdapterRegistry;
  private readonly processFactory: InstanceType<typeof ChildProcessFactory>;
  private readonly maxTextDeltaBytes: number;
  private readonly cancelKillTimeoutMs: number;
  private readonly outbox: OutboxStore | null;
  private readonly activeRuns = new Map<string, ActiveRun>();

  constructor(options: RuntimeSupervisorOptions) {
    this.db = options.db;
    this.events = new EventStore(options.db);
    this.sessions = new SessionStore(options.db, this.events);
    this.messages = new MessageStore(options.db);
    this.permissionRequests = new PermissionRequestStore(options.db);
    this.adapterRegistry = options.adapterRegistry ?? new RuntimeAdapterRegistry();
    this.processFactory = new (options.processFactory ?? ChildProcessFactory)();
    this.maxTextDeltaBytes = options.maxTextDeltaBytes ?? 4_096;
    this.cancelKillTimeoutMs = options.cancelKillTimeoutMs ?? 5_000;
    this.outbox = options.outboxStore ?? null;
  }

  startTask(input: StartRuntimeTaskInput): StartedRuntimeRun {
    const session = this.sessions.getSession(input.sessionId);
    if (!session) throw new Error(`Session not found: ${input.sessionId}`);

    const task = this.sessions.getTask(input.taskId);
    if (!task) throw new Error(`Task not found: ${input.taskId}`);

    const agentType = input.agentType ?? session.agentType;
    const runtimeKind = "acp";
    const driver = this.adapterRegistry.get(agentType, runtimeKind);
    const runId = createId("run");

    const externalSessionId = this.sessions.getLatestExternalSessionId(session.id, agentType);
    const taskInput = resolveResumeInput(task.input, task.type, externalSessionId);

    const launchContext: RuntimeLaunchContext = {
      session: {
        id: session.id,
        agentType: session.agentType,
        workspacePath: session.workspacePath,
        defaultParams: asJsonObject(session.defaultParams),
      },
      task: {
        id: task.id,
        type: task.type,
        input: taskInput,
      },
      run: { id: runId },
    };

    const launchSpec = driver.createLaunchSpec(launchContext);

    const { run } = this.sessions.startRun({
      id: runId,
      sessionId: session.id,
      taskId: task.id,
      agentType,
      launchSpec,
      runtimeKind: "acp",
    });

    try {
      const process = this.processFactory.spawn(launchSpec);
      this.sessions.updateRunProcess(run.id, process.pid);

      const earlyDrafts: RuntimeEventDraft[] = [];
      let earlyExit: RuntimeProcessExit | null = null;

      const handle = driver.start(
        { ...launchContext, launchSpec },
        process,
        {
          emit: (drafts) => {
            const normalized = Array.isArray(drafts) ? drafts : [drafts];
            if (this.activeRuns.has(run.id)) {
              this.handleDrafts(run.id, normalized);
              return;
            }
            earlyDrafts.push(...normalized);
          },
          exit: (exit) => {
            if (this.activeRuns.has(run.id)) {
              this.handleExit(run.id, exit);
              return;
            }
            earlyExit = exit;
          },
          updateProtocolState: (state) => {
            this.sessions.updateRunProtocolState(run.id, state);
          },
        },
      );

      const activeRun: ActiveRun = {
        runId: run.id,
        sessionId: session.id,
        taskId: task.id,
        driver,
        process,
        handle,
        batcher: new TextDeltaBatcher(this.maxTextDeltaBytes),
        cancelTimer: null,
        inputTokens: 0,
        outputTokens: 0,
      };
      this.activeRuns.set(run.id, activeRun);

      if (earlyDrafts.length > 0) this.handleDrafts(run.id, earlyDrafts);
      if (earlyExit) this.handleExit(run.id, earlyExit);

      return { run: this.sessions.getRun(run.id) ?? run, pid: process.pid };
    } catch (error) {
      const classification = driver.classifyError(error);
      this.sessions.finishRun({
        runId: run.id,
        status: mapClassificationToRunStatus(classification),
        errorClass: classification.class,
        stopReason: classification.message,
      });
      throw error;
    }
  }

  sendInput(runId: string, input: RuntimeInput): void {
    const activeRun = this.requireActiveRun(runId);
    activeRun.handle.sendInput(input);
  }

  respondPermission(runId: string, input: RuntimePermissionResponseInput): void {
    const activeRun = this.requireActiveRun(runId);
    if (!activeRun.handle.respondPermission) {
      throw new Error(`Runtime run does not support permission responses: ${runId}`);
    }
    activeRun.handle.respondPermission(input);
    this.permissionRequests.respond(
      runId,
      input.requestId,
      input.outcome === "cancelled" ? "cancelled" : "approved",
      input.optionId,
    );
    const run = this.sessions.getRun(runId);
    if (run?.status === "waiting_permission") {
      this.sessions.setRunStatus(runId, "running");
    }
  }

  stop(runId: string): void {
    const activeRun = this.requireActiveRun(runId);
    this.sessions.setRunStatus(runId, "stopping");
    activeRun.handle.stop();

    if (!this.activeRuns.has(runId)) return;
    if (this.cancelKillTimeoutMs <= 0 || activeRun.cancelTimer) return;

    activeRun.cancelTimer = setTimeout(() => {
      const current = this.activeRuns.get(runId);
      if (!current) return;
      this.sessions.updateRunProtocolState(runId, { cancelState: "killed" });
      current.process.stop("SIGTERM");
    }, this.cancelKillTimeoutMs);
  }

  getActiveRunBySession(sessionId: string): { runId: string; sessionId: string; taskId: string; pid: number | null } | null {
    for (const activeRun of this.activeRuns.values()) {
      if (activeRun.sessionId === sessionId) {
        return { runId: activeRun.runId, sessionId: activeRun.sessionId, taskId: activeRun.taskId, pid: activeRun.process.pid };
      }
    }
    return null;
  }

  flush(runId: string): void {
    const activeRun = this.requireActiveRun(runId);
    this.appendDrafts(activeRun, activeRun.handle.flush());
    this.appendDrafts(activeRun, activeRun.batcher.flush());
  }

  // ── Private ──

  private handleDrafts(runId: string, drafts: RuntimeEventDraft[]): void {
    const activeRun = this.activeRuns.get(runId);
    if (!activeRun) return;

    for (const draft of drafts) {
      if (draft.type === "usage_report") {
        const payload = draft.payload as Record<string, unknown>;
        if (typeof payload.inputTokens === "number") activeRun.inputTokens += payload.inputTokens;
        if (typeof payload.outputTokens === "number") activeRun.outputTokens += payload.outputTokens;
        continue;
      }
      if (draft.type === "text_delta") {
        this.appendDrafts(activeRun, activeRun.batcher.push(draft));
      } else {
        this.appendDrafts(activeRun, activeRun.batcher.flush());
        this.appendDrafts(activeRun, [draft]);
      }
    }
  }

  private handleExit(runId: string, exit: RuntimeProcessExit): void {
    const activeRun = this.activeRuns.get(runId);
    if (!activeRun) return;

    this.appendDrafts(activeRun, activeRun.batcher.flush());

    if (activeRun.cancelTimer) clearTimeout(activeRun.cancelTimer);

    const classification = classifyExit(activeRun.driver, exit);
    this.sessions.finishRun({
      runId,
      status: exit.exitCode === 0 && !exit.signal ? "succeeded" : mapClassificationToRunStatus(classification),
      exitCode: exit.exitCode,
      stopReason: exit.message ?? exit.signal,
      errorClass: exit.exitCode === 0 && !exit.signal ? null : classification.class,
      stoppedAt: exit.exitedAt,
      inputTokens: activeRun.inputTokens,
      outputTokens: activeRun.outputTokens,
    });

    this.persistAgentMessage(activeRun);
    this.enqueueRunReply(activeRun);

    this.activeRuns.delete(runId);
  }

  private appendDrafts(activeRun: ActiveRun, drafts: RuntimeEventDraft[]): void {
    for (const draft of drafts) {
      const event = this.events.append({
        sessionId: activeRun.sessionId,
        runId: activeRun.runId,
        taskId: activeRun.taskId,
        type: draft.type,
        payload: draft.payload,
        createdAt: nowIso(),
      });
      if (draft.type === "permission_prompt") {
        const acpRequestId = typeof draft.payload.requestId === "string" ? draft.payload.requestId : null;
        this.permissionRequests.upsert({
          sessionId: activeRun.sessionId,
          runId: activeRun.runId,
          taskId: activeRun.taskId,
          eventId: event.id,
          acpRequestId,
          prompt: typeof draft.payload.prompt === "string"
            ? draft.payload.prompt
            : typeof draft.payload.text === "string"
              ? draft.payload.text
              : "Agent requests permission",
          options: draft.payload.options,
          toolCall: draft.payload.toolCall,
        });
        this.sessions.setRunStatus(activeRun.runId, "waiting_permission");
      }
    }
  }

  private requireActiveRun(runId: string): ActiveRun {
    const activeRun = this.activeRuns.get(runId);
    if (!activeRun) throw new Error(`Runtime run is not active: ${runId}`);
    return activeRun;
  }

  private formatStats(activeRun: ActiveRun, agentType?: string): string {
    const run = this.sessions.getRun(activeRun.runId);
    const durationSec = run?.startedAt && run?.stoppedAt
      ? ((new Date(run.stoppedAt).getTime() - new Date(run.startedAt).getTime()) / 1000).toFixed(1)
      : null;

    const statsParts: string[] = [];
    if (durationSec) statsParts.push(`⏱ ${durationSec}s`);
    const hasTokens = activeRun.inputTokens > 0 || activeRun.outputTokens > 0;
    if (hasTokens) {
      const tokenParts: string[] = [];
      if (activeRun.inputTokens > 0) tokenParts.push(`in ${activeRun.inputTokens.toLocaleString()}`);
      if (activeRun.outputTokens > 0) tokenParts.push(`out ${activeRun.outputTokens.toLocaleString()}`);
      statsParts.push(tokenParts.join(" / "));
      const cost = estimateCost(activeRun.inputTokens, activeRun.outputTokens, agentType);
      if (cost > 0) statsParts.push(`$${cost.toFixed(4)}`);
    }
    return statsParts.length > 0 ? `\n\n${statsParts.join(" · ")}` : "";
  }

  private collectRunText(activeRun: ActiveRun): string {
    return this.events.listByRun(activeRun.runId, "text_delta")
      .map((e) => typeof (e.payload as Record<string, unknown>)?.text === "string" ? (e.payload as Record<string, unknown>).text as string : "")
      .join("");
  }

  private persistAgentMessage(activeRun: ActiveRun): void {
    const text = this.collectRunText(activeRun);
    if (!text) return;

    const deltas = this.events.listByRun(activeRun.runId, "text_delta");
    const lastDelta = deltas[deltas.length - 1];
    const stats = this.formatStats(activeRun);
    this.messages.insert({
      sessionId: activeRun.sessionId,
      runId: activeRun.runId,
      role: "assistant",
      content: text + stats,
      sourceEventId: lastDelta.id,
    });
  }

  private enqueueRunReply(activeRun: ActiveRun): void {
    if (!this.outbox) return;

    const session = this.sessions.getSession(activeRun.sessionId);
    if (!session?.channelType || !session.channelRef) return;

    const text = this.collectRunText(activeRun);
    if (!text) return;

    const stats = this.formatStats(activeRun, session.agentType);
    const fullText = text + stats;

    const channelType = session.channelType as OutboxChannel;
    const kind = `${channelType}_markdown` as OutboxKind;
    const maxLen = CHANNEL_MAX_CONTENT[channelType] ?? 4096;
    const chunks = splitChunks(fullText, maxLen);

    for (let i = 0; i < chunks.length; i++) {
      this.outbox.enqueue({
        sessionId: session.id,
        channelType,
        targetRef: session.channelRef,
        kind,
        viewModel: { text: chunks[i], chunkIndex: i, totalChunks: chunks.length },
        idempotencyKey: `${activeRun.runId}:reply:${i}`,
      });
    }
  }
}

// ── Helpers ──

function classifyExit(driver: RuntimeSessionDriver, exit: RuntimeProcessExit): RuntimeErrorClassification {
  if (exit.exitCode === 0 && !exit.signal) {
    return { class: "unknown", message: "Process exited successfully", retryable: false };
  }
  return driver.classifyError(exit.message ?? exit.signal ?? `Process exited with code ${exit.exitCode}`);
}

function mapClassificationToRunStatus(
  classification: RuntimeErrorClassification,
): Extract<AgentRunRecord["status"], "failed" | "cancelled" | "overflowed"> {
  if (classification.class === "context_overflow") return "overflowed";
  if (classification.class === "user_cancelled") return "cancelled";
  return "failed";
}

function asJsonObject(value: JsonValue): JsonObject {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  return {};
}

function resolveResumeInput(input: JsonValue, taskType: string, externalSessionId: string | null): JsonValue {
  if (taskType !== "resume" || !externalSessionId) return input;
  const object = asJsonObject(input);
  if (typeof object.externalSessionId === "string") return input;
  return { ...object, externalSessionId };
}

const CHANNEL_MAX_CONTENT: Record<string, number> = {
  qq: 2048,
  feishu: 4096,
  telegram: 4096,
  discord: 2000,
  wechat: 2000,
  wecom: 4096,
  dingtalk: 4096,
  web: 1_000_000,
};

function splitChunks(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > 0) {
    if (rest.length <= maxLen) { chunks.push(rest); break; }
    let cut = rest.lastIndexOf("\n", maxLen);
    if (cut < maxLen * 0.5) cut = maxLen;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  return chunks;
}

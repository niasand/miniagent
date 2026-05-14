import { createId } from "../../shared/ids.js";
import type { JsonObject, JsonValue } from "../../shared/json.js";
import { nowIso } from "../../shared/time.js";
import { EventStore } from "../events/event-store.js";
import { SessionStore, type AgentRunRecord } from "../sessions/session-store.js";
import type { RuntimePermissionResponseInput, RuntimeRunHandle, RuntimeSessionDriver } from "./driver.js";
import { RuntimeAdapterRegistry } from "./registry.js";
import type { RuntimeProcess, RuntimeProcessExit, RuntimeProcessFactory } from "./process.js";
import { ChildProcessFactory } from "./process.js";
import { TextDeltaBatcher } from "./text-delta-batcher.js";
import type {
  AgentType,
  RuntimeErrorClassification,
  RuntimeInput,
  RuntimeLaunchSpec,
  RuntimeEventDraft,
} from "./types.js";

export type RuntimeSupervisorOptions = {
  adapterRegistry?: RuntimeAdapterRegistry;
  sessionStore: SessionStore;
  eventStore: EventStore;
  processFactory?: RuntimeProcessFactory;
  maxTextDeltaBytes?: number;
};

export type StartRuntimeTaskInput = {
  sessionId: string;
  taskId: string;
  agentType?: AgentType;
};

export type StartedRuntimeRun = {
  run: AgentRunRecord;
  launchSpec: RuntimeLaunchSpec;
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
};

export class RuntimeSupervisor {
  private readonly adapterRegistry: RuntimeAdapterRegistry;
  private readonly processFactory: RuntimeProcessFactory;
  private readonly maxTextDeltaBytes: number;
  private readonly activeRuns = new Map<string, ActiveRun>();

  constructor(private readonly options: RuntimeSupervisorOptions) {
    this.adapterRegistry = options.adapterRegistry ?? new RuntimeAdapterRegistry();
    this.processFactory = options.processFactory ?? new ChildProcessFactory();
    this.maxTextDeltaBytes = options.maxTextDeltaBytes ?? 4_096;
  }

  startTask(input: StartRuntimeTaskInput): StartedRuntimeRun {
    const session = this.options.sessionStore.getSession(input.sessionId);
    if (!session) {
      throw new Error(`Session not found: ${input.sessionId}`);
    }

    const task = this.options.sessionStore.getTask(input.taskId);
    if (!task) {
      throw new Error(`Task not found: ${input.taskId}`);
    }

    const agentType = input.agentType ?? toAgentType(session.agentType);
    const driver = this.adapterRegistry.get(agentType);
    const runId = createId("run");
    const launchContext = {
      session: {
        id: session.id,
        agentType: session.agentType,
        workspacePath: session.workspacePath,
        defaultParams: asJsonObject(session.defaultParams),
      },
      task: {
        id: task.id,
        type: task.type,
        input: task.input,
      },
      run: { id: runId },
    };
    const launchSpec = driver.createLaunchSpec(launchContext);

    const { run } = this.options.sessionStore.startRun({
      id: runId,
      sessionId: session.id,
      taskId: task.id,
      agentType,
      launchSpec,
      runtimeKind: driver.runtimeKind,
    });

    try {
      const process = this.processFactory.spawn(launchSpec);
      this.options.sessionStore.updateRunProcess(run.id, process.pid);
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
            this.options.sessionStore.updateRunProtocolState(run.id, state);
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
      };
      this.activeRuns.set(run.id, activeRun);
      if (earlyDrafts.length > 0) {
        this.handleDrafts(run.id, earlyDrafts);
      }
      if (earlyExit) {
        this.handleExit(run.id, earlyExit);
      }

      return { run: this.options.sessionStore.getRun(run.id) ?? run, launchSpec, pid: process.pid };
    } catch (error) {
      const classification = driver.classifyError(error);
      this.options.sessionStore.finishRun({
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
  }

  stop(runId: string): void {
    this.requireActiveRun(runId).handle.stop();
  }

  flush(runId: string): void {
    const activeRun = this.requireActiveRun(runId);
    this.appendDrafts(activeRun, activeRun.handle.flush());
    this.appendDrafts(activeRun, activeRun.batcher.flush());
  }

  private handleDrafts(runId: string, drafts: RuntimeEventDraft[]): void {
    const activeRun = this.activeRuns.get(runId);
    if (!activeRun) {
      return;
    }

    for (const draft of drafts) {
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
    if (!activeRun) {
      return;
    }

    this.appendDrafts(activeRun, activeRun.batcher.flush());

    const classification = classifyExit(activeRun.driver, exit);
    this.options.sessionStore.finishRun({
      runId,
      status: exit.exitCode === 0 && !exit.signal ? "succeeded" : mapClassificationToRunStatus(classification),
      exitCode: exit.exitCode,
      stopReason: exit.message ?? exit.signal,
      errorClass: exit.exitCode === 0 && !exit.signal ? null : classification.class,
      stoppedAt: exit.exitedAt,
    });

    this.activeRuns.delete(runId);
  }

  private appendDrafts(activeRun: ActiveRun, drafts: RuntimeEventDraft[]): void {
    for (const draft of drafts) {
      this.options.eventStore.append({
        sessionId: activeRun.sessionId,
        runId: activeRun.runId,
        taskId: activeRun.taskId,
        type: draft.type,
        payload: draft.payload,
        createdAt: nowIso(),
      });
    }
  }

  private requireActiveRun(runId: string): ActiveRun {
    const activeRun = this.activeRuns.get(runId);
    if (!activeRun) {
      throw new Error(`Runtime run is not active: ${runId}`);
    }
    return activeRun;
  }
}

function classifyExit(adapter: RuntimeSessionDriver, exit: RuntimeProcessExit): RuntimeErrorClassification {
  if (exit.exitCode === 0 && !exit.signal) {
    return { class: "unknown", message: "Process exited successfully", retryable: false };
  }

  return adapter.classifyError(exit.message ?? exit.signal ?? `Process exited with code ${exit.exitCode}`);
}

function mapClassificationToRunStatus(
  classification: RuntimeErrorClassification,
): Extract<AgentRunRecord["status"], "failed" | "cancelled" | "overflowed"> {
  if (classification.class === "context_overflow") {
    return "overflowed";
  }
  if (classification.class === "user_cancelled") {
    return "cancelled";
  }
  return "failed";
}

function toAgentType(value: string): AgentType {
  if (value === "codex" || value === "claude" || value === "trae") {
    return value;
  }
  throw new Error(`Unsupported agent type: ${value}`);
}

function asJsonObject(value: JsonValue): JsonObject {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  return {};
}

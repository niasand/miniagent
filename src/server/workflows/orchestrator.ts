import type { SqliteDatabase } from "../db/migrate.js";
import { EventStore } from "../stores/event-store.js";
import { SessionStore } from "../stores/session-store.js";
import { MessageStore } from "../stores/message-store.js";
import { createId } from "../../shared/ids.js";
import { nowIso } from "../../shared/time.js";
import type { JsonValue } from "../../shared/json.js";
import {
  validateWorkflow,
  type GateDecision,
  type NodeDefinition,
  type NodeType,
  type WorkflowDefinition,
} from "./definition.js";
import { WorkflowRunStore, type WorkflowRunRecord, type WorkflowRunStatus } from "./store.js";
import type { NodeHandler, NodeExecContext } from "./nodes/types.js";
import { echoHandler } from "./nodes/echo.js";
import { humanGateHandler } from "./nodes/human-gate.js";
import type { RuntimeService } from "../runtime/service.js";

type NodeStateStatus = "pending" | "running" | "succeeded" | "failed" | "waiting_gate";

interface NodeState {
  status: NodeStateStatus;
  output?: JsonValue;
  error?: string;
  /** agent_task only: the agent run id launched for this node. */
  agentRunId?: string;
}

interface RunState {
  runId: string;
  sessionId: string;
  definition: WorkflowDefinition;
  topoOrder: string[];
  status: WorkflowRunStatus;
  completed: boolean;
  nodes: Map<string, NodeState>;
  currentGateNode: string | null;
}

/**
 * Event-driven DAG workflow engine. Workflow facts live in the EventStore as wf.*
 * events; this class replays them to derive state and advances runs to a fixpoint.
 * append → synchronous advance is the main path; advanceAllDue is a restart-recovery
 * tick that also drains completed agent_task runs.
 */
export class WorkflowOrchestrator {
  private readonly events: EventStore;
  private readonly sessions: SessionStore;
  private readonly runs: WorkflowRunStore;
  private readonly messages: MessageStore;
  private readonly handlers: Partial<Record<NodeType, NodeHandler>> = {
    echo: echoHandler,
    human_gate: humanGateHandler,
  };

  constructor(private readonly db: SqliteDatabase, private readonly runtimeService?: RuntimeService) {
    this.events = new EventStore(db);
    this.sessions = new SessionStore(db, this.events);
    this.runs = new WorkflowRunStore(db);
    this.messages = new MessageStore(db);
  }

  getRun(runId: string): WorkflowRunRecord | null {
    return this.runs.get(runId);
  }

  listRuns(): WorkflowRunRecord[] {
    return this.runs.listRecent();
  }

  deleteRun(runId: string): void {
    this.runs.delete(runId);
  }

  startRun(input: { definition: WorkflowDefinition; input?: JsonValue }): { runId: string; sessionId: string } {
    const validation = validateWorkflow(input.definition);
    if (!validation.ok) {
      throw new Error(`invalid workflow definition: ${validation.errors.join("; ")}`);
    }

    const sessionId = createId("ses");
    this.sessions.createSession({
      id: sessionId,
      title: `workflow: ${input.definition.name}`,
      agentType: "workflow",
      workspacePath: "",
      channelType: "web",
    });

    const runId = createId("wfr");
    this.runs.create({ id: runId, sessionId, definition: input.definition });

    this.emit(sessionId, runId, "wf.run_started", { definition: input.definition, input: input.input ?? null });
    this.advance(runId);
    return { runId, sessionId };
  }

  resolveGate(input: {
    runId: string;
    nodeId: string;
    decision: GateDecision;
    resolvedBy?: string;
    note?: string;
  }): void {
    const state = this.buildRunState(input.runId);
    if (!state) throw new Error(`workflow run not found: ${input.runId}`);
    if (state.currentGateNode !== input.nodeId) {
      throw new Error(`gate not open or already resolved: node ${input.nodeId}`);
    }

    this.emit(state.sessionId, input.runId, "wf.gate_resolved", {
      nodeId: input.nodeId,
      decision: input.decision,
      resolvedBy: input.resolvedBy ?? "web",
      note: input.note ?? null,
    });

    if (input.decision === "approve") {
      this.emit(state.sessionId, input.runId, "wf.node_succeeded", {
        nodeId: input.nodeId,
        output: { approved: true, note: input.note ?? null },
      });
      this.runs.updateStatus(input.runId, {
        status: "running", currentGateNode: null, finishedAt: null, errorNode: null, errorReason: null,
      });
      this.advance(input.runId);
    } else {
      this.emit(state.sessionId, input.runId, "wf.node_failed", {
        nodeId: input.nodeId, error: "gate rejected", errorClass: "gate_rejected",
      });
      this.completeRun(input.runId, "failed", input.nodeId, "gate rejected");
    }
  }

  /** Reconciler tick: drain finished agent_task runs, then re-advance non-terminal runs. */
  advanceAllDue(): void {
    const due = this.runs.listByStatus(["running", "waiting_gate"]);
    for (const run of due) {
      try {
        this.checkAgentTasks(run.id);
        this.advance(run.id);
      } catch (err) {
        console.error(`[Workflow] advanceAllDue failed for ${run.id}:`, err instanceof Error ? err.message : err);
      }
    }
  }

  // ── Private ──

  private advance(runId: string): void {
    let guard = 0;
    while (guard++ < 1000) {
      const state = this.buildRunState(runId);
      if (!state) return;
      if (state.completed) return; // run_completed already emitted — terminal
      if (state.currentGateNode) {
        // Sync the projection so HTTP/SSE observers see waiting_gate.
        this.runs.updateStatus(runId, {
          status: "waiting_gate",
          currentGateNode: state.currentGateNode,
          finishedAt: null,
          errorNode: null,
          errorReason: null,
        });
        return; // blocked on a human gate
      }

      let acted = false;
      for (const nodeId of state.topoOrder) {
        const ns = state.nodes.get(nodeId);
        if (!ns || ns.status !== "pending") continue; // skip running/succeeded/failed
        const node = state.definition.nodes.find((n) => n.id === nodeId);
        if (!node) continue;
        const deps = node.dependsOn ?? [];

        if (deps.some((d) => state.nodes.get(d)?.status === "failed")) {
          this.emit(state.sessionId, runId, "wf.node_failed", {
            nodeId, error: "dependency failed", errorClass: "dep_failed",
          });
          acted = true;
          break;
        }
        if (!deps.every((d) => state.nodes.get(d)?.status === "succeeded")) continue;

        this.emit(state.sessionId, runId, "wf.node_dispatched", {
          nodeId, nodeType: node.type, nodeInput: node.input ?? null,
        });
        this.executeNode(state, node);
        acted = true;
        break;
      }

      if (!acted) {
        this.tryComplete(runId);
        return;
      }
    }
  }

  private executeNode(state: RunState, node: NodeDefinition): void {
    if (node.type === "agent_task") {
      this.executeAgentTask(state, node);
      return;
    }
    const handler = this.handlers[node.type];
    const ctx: NodeExecContext = {
      runId: state.runId,
      sessionId: state.sessionId,
      node,
      emit: (type, payload) => this.emit(state.sessionId, state.runId, type, payload),
    };
    if (!handler) {
      this.emit(state.sessionId, state.runId, "wf.node_failed", {
        nodeId: node.id, error: `no handler for node type "${node.type}"`, errorClass: "no_handler",
      });
      return;
    }
    handler.execute(ctx);
  }

  /** Launch a real agent run in an independent session; emits agent_run_started (no succeeded yet). */
  private executeAgentTask(state: RunState, node: NodeDefinition): void {
    if (!this.runtimeService) {
      this.emit(state.sessionId, state.runId, "wf.node_failed", {
        nodeId: node.id, error: "runtimeService not configured (cannot run agent_task)", errorClass: "no_runtime",
      });
      return;
    }
    try {
      const agentSession = this.sessions.createSession({
        title: `workflow agent_task: ${node.id}`,
        agentType: node.agentType ?? "claude",
        // Default to the API process cwd (always in the workspace allowlist) so agent_task
        // works without an explicit workspacePath; nodes can override with an allowed path.
        workspacePath: node.workspacePath || process.cwd(),
        channelType: "web",
      });
      this.sessions.createTask({
        sessionId: agentSession.id,
        sourceType: "system",
        type: "message",
        input: { text: node.prompt ?? "" },
      });
      // startNextQueuedTask asserts WorkspacePolicy internally and spawns + feeds the run.
      const result = this.runtimeService.startNextQueuedTask(agentSession.id);
      if (!result) {
        this.emit(state.sessionId, state.runId, "wf.node_failed", {
          nodeId: node.id, error: "failed to start agent run", errorClass: "start_failed",
        });
        return;
      }
      this.emit(state.sessionId, state.runId, "wf.agent_run_started", {
        nodeId: node.id, agentRunId: result.run.id, agentSessionId: agentSession.id,
      });
    } catch (err) {
      this.emit(state.sessionId, state.runId, "wf.node_failed", {
        nodeId: node.id, error: err instanceof Error ? err.message : "agent_task start failed", errorClass: "start_failed",
      });
    }
  }

  /** Poll running agent_task nodes; if their agent run finished, emit succeeded/failed. */
  private checkAgentTasks(runId: string): void {
    const state = this.buildRunState(runId);
    if (!state) return;
    for (const [nodeId, ns] of state.nodes) {
      if (ns.status !== "running" || !ns.agentRunId) continue;
      const agentRun = this.sessions.getRun(ns.agentRunId);
      if (!agentRun) continue;
      if (agentRun.status === "succeeded") {
        const text = this.collectAgentOutput(agentRun.sessionId, ns.agentRunId);
        this.emit(state.sessionId, runId, "wf.node_succeeded", {
          nodeId, output: { text, agentRunId: ns.agentRunId },
        });
      } else if (agentRun.status === "failed" || agentRun.status === "cancelled" || agentRun.status === "overflowed") {
        this.emit(state.sessionId, runId, "wf.node_failed", {
          nodeId, error: agentRun.errorClass ?? agentRun.stopReason ?? "agent run failed",
          errorClass: agentRun.errorClass ?? "agent_failed",
        });
      }
      // still running: leave alone, tick again later
    }
  }

  private collectAgentOutput(sessionId: string, runId: string): string {
    const msgs = this.messages.listBySession(sessionId);
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === "assistant" && msgs[i].runId === runId) return msgs[i].content;
    }
    return "";
  }

  private tryComplete(runId: string): void {
    const state = this.buildRunState(runId);
    if (!state) return;
    if (state.completed) return;
    // A run is settled only when every node is succeeded/failed (running agent_tasks block).
    const allSettled = [...state.nodes.values()].every((n) => n.status === "succeeded" || n.status === "failed");
    if (!allSettled) return;
    const failed = [...state.nodes.entries()].find(([, n]) => n.status === "failed");
    if (failed) {
      this.completeRun(runId, "failed", failed[0], failed[1].error ?? "node failed");
    } else {
      this.completeRun(runId, "succeeded", null, null);
    }
  }

  private completeRun(runId: string, status: "succeeded" | "failed", errorNode: string | null, errorReason: string | null): void {
    const state = this.buildRunState(runId);
    if (!state) return;
    if (state.completed) return; // run_completed already emitted — idempotent
    this.emit(state.sessionId, runId, "wf.run_completed", { status, errorNode });
    this.runs.updateStatus(runId, {
      status, currentGateNode: null, finishedAt: nowIso(), errorNode, errorReason,
    });
  }

  private buildRunState(runId: string): RunState | null {
    const run = this.runs.get(runId);
    if (!run) return null;
    const { topoOrder } = validateWorkflow(run.definition);
    const events = this.events.listByRun(runId);

    const nodes = new Map<string, NodeState>();
    for (const n of run.definition.nodes) nodes.set(n.id, { status: "pending" });

    let currentGateNode: string | null = null;
    let completed: WorkflowRunStatus | null = null;

    for (const e of events) {
      const p = (e.payload ?? {}) as Record<string, unknown>;
      const nodeId = typeof p.nodeId === "string" ? p.nodeId : null;
      switch (e.type) {
        case "wf.node_dispatched": {
          const ns = nodeId ? nodes.get(nodeId) : null;
          if (ns && ns.status === "pending") ns.status = "running";
          break;
        }
        case "wf.agent_run_started": {
          const ns = nodeId ? nodes.get(nodeId) : null;
          if (ns && typeof p.agentRunId === "string") ns.agentRunId = p.agentRunId;
          break;
        }
        case "wf.node_succeeded": {
          const ns = nodeId ? nodes.get(nodeId) : null;
          if (ns) { ns.status = "succeeded"; ns.output = p.output as JsonValue | undefined; }
          break;
        }
        case "wf.node_failed": {
          const ns = nodeId ? nodes.get(nodeId) : null;
          if (ns) { ns.status = "failed"; ns.error = typeof p.error === "string" ? p.error : undefined; }
          break;
        }
        case "wf.gate_opened":
          if (nodeId && nodes.has(nodeId)) currentGateNode = nodeId;
          break;
        case "wf.gate_resolved":
          if (currentGateNode === nodeId) currentGateNode = null;
          break;
        case "wf.run_completed":
          completed = p.status === "succeeded" ? "succeeded" : "failed";
          break;
      }
    }

    let status: WorkflowRunStatus;
    if (completed) status = completed;
    else if ([...nodes.values()].some((n) => n.status === "failed")) status = "failed";
    else if (currentGateNode) status = "waiting_gate";
    else status = "running";

    return {
      runId, sessionId: run.sessionId, definition: run.definition,
      topoOrder, status, completed: completed !== null, nodes, currentGateNode,
    };
  }

  private emit(sessionId: string, runId: string, type: string, payload: Record<string, unknown>): void {
    this.events.append({ sessionId, runId, type, payload: payload as unknown as JsonValue, createdAt: nowIso() });
  }
}

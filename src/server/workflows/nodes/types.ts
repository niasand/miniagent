import type { JsonValue } from "../../../shared/json.js";
import type { NodeDefinition } from "../definition.js";

export interface NodeExecContext {
  runId: string;
  sessionId: string;
  node: NodeDefinition;
  /** Append a wf.* event to the EventStore. */
  emit: (type: string, payload: Record<string, unknown>) => void;
}

export interface NodeHandler {
  /**
   * Execute the node synchronously. Must emit wf.node_succeeded or wf.node_failed
   * via ctx.emit (human_gate instead emits wf.gate_opened and waits for a resolve).
   */
  execute(ctx: NodeExecContext): void;
}

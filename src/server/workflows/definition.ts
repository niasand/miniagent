import type { JsonValue } from "../../shared/json.js";

export type NodeType = "echo" | "human_gate" | "agent_task";
export type GateDecision = "approve" | "reject";

export interface NodeDefinition {
  id: string;
  type: NodeType;
  /** Nodes that must succeed before this one can dispatch. */
  dependsOn?: string[];
  /** echo: text emitted as the node output. */
  message?: string;
  /** human_gate: prompt shown to the approver in the Web UI. */
  prompt?: string;
  input?: JsonValue;
}

export interface WorkflowDefinition {
  name: string;
  nodes: NodeDefinition[];
  input?: JsonValue;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  /** Node ids in dependency order (undefined nodes excluded). Empty if cyclic. */
  topoOrder: string[];
}

const KNOWN_NODE_TYPES: NodeType[] = ["echo", "human_gate", "agent_task"];

/** Validate structure + semantics and return a topological order. Pure function. */
export function validateWorkflow(def: WorkflowDefinition): ValidationResult {
  const errors: string[] = [];

  if (!Array.isArray(def.nodes) || def.nodes.length === 0) {
    return { ok: false, errors: ["workflow must define at least one node"], topoOrder: [] };
  }

  const ids = new Set<string>();
  for (const node of def.nodes) {
    if (!node.id) {
      errors.push("node missing id");
      continue;
    }
    if (ids.has(node.id)) errors.push(`duplicate node id: "${node.id}"`);
    ids.add(node.id);
  }

  for (const node of def.nodes) {
    if (!node.id) continue;
    for (const dep of node.dependsOn ?? []) {
      if (!ids.has(dep)) errors.push(`node "${node.id}" depends on unknown node "${dep}"`);
    }
    if (!(KNOWN_NODE_TYPES as string[]).includes(node.type)) {
      errors.push(`node "${node.id}" has unknown type "${node.type}"`);
    }
    if (node.type === "human_gate" && !node.prompt) {
      errors.push(`human_gate node "${node.id}" is missing a prompt`);
    }
    if (node.type === "agent_task") {
      errors.push(`agent_task node "${node.id}" is not implemented in this spike`);
    }
  }

  const topoOrder = topoSort(def.nodes, errors);
  return { ok: errors.length === 0, errors, topoOrder };
}

/** Kahn's algorithm; pushes a cycle error if not all nodes are ordered. */
function topoSort(nodes: NodeDefinition[], errors: string[]): string[] {
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const node of nodes) {
    if (!node.id) continue;
    inDegree.set(node.id, 0);
    adj.set(node.id, []);
  }
  for (const node of nodes) {
    if (!node.id) continue;
    for (const dep of node.dependsOn ?? []) {
      if (!inDegree.has(dep)) continue; // unknown dep already reported above
      adj.get(dep)!.push(node.id);
      inDegree.set(node.id, (inDegree.get(node.id) ?? 0) + 1);
    }
  }
  const queue: string[] = [];
  for (const [id, deg] of inDegree) if (deg === 0) queue.push(id);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const next of adj.get(id) ?? []) {
      const deg = (inDegree.get(next) ?? 1) - 1;
      inDegree.set(next, deg);
      if (deg === 0) queue.push(next);
    }
  }
  if (order.length !== inDegree.size) errors.push("workflow contains a cycle");
  return order;
}

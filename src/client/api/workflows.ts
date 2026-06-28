export type WorkflowRunStatus = "running" | "waiting_gate" | "succeeded" | "failed" | "cancelled";

export type WorkflowNode = {
  id: string;
  type: "echo" | "human_gate" | "agent_task";
  dependsOn?: string[];
  message?: string;
  prompt?: string;
  agentType?: string;
};

export type WorkflowRun = {
  id: string;
  sessionId: string;
  definition: { name: string; nodes: WorkflowNode[] };
  status: WorkflowRunStatus;
  currentGateNode: string | null;
  startedAt: string;
  finishedAt: string | null;
  errorNode: string | null;
  errorReason: string | null;
};

export async function listWorkflowRuns(): Promise<WorkflowRun[]> {
  const res = await fetch("/api/workflows/runs", { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`listWorkflowRuns failed: ${res.status}`);
  const body = (await res.json()) as { runs: WorkflowRun[] };
  return body.runs ?? [];
}

export async function resolveWorkflowGate(
  runId: string,
  nodeId: string,
  decision: "approve" | "reject",
  note?: string,
): Promise<void> {
  const res = await fetch(
    `/api/workflows/runs/${encodeURIComponent(runId)}/gates/${encodeURIComponent(nodeId)}/resolve`,
    {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ decision, note }),
    },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `resolveGate failed: ${res.status}`);
  }
}

export async function createWorkflowRun(definition: unknown): Promise<{ runId: string; sessionId: string }> {
  const res = await fetch("/api/workflows/runs", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ definition }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `createWorkflowRun failed: ${res.status}`);
  }
  return (await res.json()) as { runId: string; sessionId: string };
}

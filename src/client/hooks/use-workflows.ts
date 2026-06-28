import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { listWorkflowRuns, resolveWorkflowGate, type WorkflowRun } from "../api/workflows.js";

export type ResolveInput = { runId: string; nodeId: string; decision: "approve" | "reject" };

/** Polls workflow runs every 2s while the workflows section is active. */
export function useWorkflows(activeSection: string) {
  const queryClient = useQueryClient();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ["workflows"],
    queryFn: listWorkflowRuns,
    enabled: activeSection === "workflows",
    refetchInterval: 2000,
  });
  const runs: WorkflowRun[] = data ?? [];
  const selectedRun = runs.find((r) => r.id === selectedRunId) ?? null;

  const resolveMutation = useMutation({
    mutationFn: (input: ResolveInput) => resolveWorkflowGate(input.runId, input.nodeId, input.decision),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["workflows"] }),
  });

  return {
    runs,
    selectedRun,
    selectedRunId,
    setSelectedRunId,
    resolveGate: resolveMutation.mutate,
    resolving: resolveMutation.isPending,
  };
}

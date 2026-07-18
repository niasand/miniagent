import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { batchDeleteWorkflowRuns, createWorkflowRun, listWorkflowRuns, resolveWorkflowGate, type WorkflowRun } from "../api/workflows.js";

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

  const createMutation = useMutation({
    mutationFn: (definition: unknown) => createWorkflowRun(definition),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["workflows"] }),
  });

  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const toggleSelected = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  };
  const deleteMutation = useMutation({
    mutationFn: (runIds: string[]) => batchDeleteWorkflowRuns(runIds),
    onSuccess: () => {
      setSelectedIds(new Set());
      setSelectionMode(false);
      queryClient.invalidateQueries({ queryKey: ["workflows"] });
    },
  });
  const deleteSelected = () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    deleteMutation.mutate(ids);
  };
  const selectAll = () => setSelectedIds(new Set(runs.map((r) => r.id)));
  const deleteOne = (id: string) => deleteMutation.mutate([id]);

  return {
    runs,
    selectedRun,
    selectedRunId,
    setSelectedRunId,
    resolveGate: resolveMutation.mutate,
    resolving: resolveMutation.isPending,
    createRun: createMutation.mutate,
    creating: createMutation.isPending,
    selectionMode,
    setSelectionMode,
    selectedIds,
    toggleSelected,
    exitSelectionMode,
    deleteSelected,
    deleting: deleteMutation.isPending,
    selectAll,
    deleteOne,
  };
}

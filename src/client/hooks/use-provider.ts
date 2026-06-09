import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { fetchAgents, resolveAgentDefault, setAgentDefault } from "../api/agents.js";
import type { AgentType } from "../api/types.js";
import { localizeProviderErrorMessage } from "../lib/error-messages.js";

const DEFAULT_AGENT_TYPE: AgentType = "claude";

function isAgentType(value: string | null): value is AgentType {
  return value === "codex" || value === "claude" || value === "trae";
}

export function useProvider() {
  const queryClient = useQueryClient();
  const [agentType, setAgentTypeState] = useState<AgentType>(DEFAULT_AGENT_TYPE);
  const [providerError, setProviderError] = useState<string | null>(null);

  const { data: providerRuntimesData, error: providerRuntimesError } = useQuery({
    queryKey: ["agents"],
    queryFn: fetchAgents,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
  const providerRuntimes = providerRuntimesData?.agents ?? [];

  const { data: providerDefaultData, error: providerDefaultError } = useQuery({
    queryKey: ["agent-defaults", "resolve"],
    queryFn: resolveAgentDefault,
    staleTime: 30_000,
  });

  // Sync agent type from defaults or first healthy runtime
  // Why: agent type must reflect what's actually available on the system
  useEffect(() => {
    if (providerDefaultData?.default.agentType && isAgentType(providerDefaultData.default.agentType)) {
      setAgentTypeState(providerDefaultData.default.agentType);
      return;
    }
    const firstHealthyRuntime = providerRuntimes.find((runtime) => runtime.status === "healthy");
    if (!firstHealthyRuntime) return;
    setAgentTypeState((current) => {
      const currentRuntime = providerRuntimes.find((runtime) => runtime.agentType === current);
      return currentRuntime?.status === "healthy" ? current : firstHealthyRuntime.agentType;
    });
  }, [providerDefaultData, providerRuntimes]);

  const saveAgentDefaultMutation = useMutation({
    mutationFn: async (nextAgentType: AgentType) => {
      return setAgentDefault({
        scopeType: "system",
        scopeRef: "default",
        agentType: nextAgentType,
      });
    },
    onMutate: (nextAgentType) => {
      setProviderError(null);
      const previousAgentType = agentType;
      setAgentTypeState(nextAgentType);
      return { previousAgentType };
    },
    onSuccess: (data) => {
      setAgentTypeState(data.default.agentType);
      queryClient.invalidateQueries({ queryKey: ["agent-defaults", "resolve"] });
    },
    onError: (error, _nextAgentType, context) => {
      if (context?.previousAgentType) {
        setAgentTypeState(context.previousAgentType);
      }
      setProviderError(localizeProviderErrorMessage(error instanceof Error ? error.message : "Save provider failed"));
    },
  });

  const setAgentType = (nextAgentType: AgentType) => {
    if (nextAgentType === agentType || saveAgentDefaultMutation.isPending) return;
    saveAgentDefaultMutation.mutate(nextAgentType);
  };

  const effectiveProviderError = providerError
    ?? (providerRuntimesError instanceof Error ? localizeProviderErrorMessage(providerRuntimesError.message) : null)
    ?? (providerDefaultError instanceof Error ? localizeProviderErrorMessage(providerDefaultError.message) : null);

  return {
    agentType,
    setAgentType,
    providerRuntimes,
    providerSavePending: saveAgentDefaultMutation.isPending,
    providerError: effectiveProviderError,
  } as const;
}

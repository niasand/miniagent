import type { AgentsResponse } from "../../shared/workspace.js";

export async function fetchAgents(): Promise<AgentsResponse> {
  const response = await fetch("/api/agents", {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Agents API failed: ${response.status}`);
  }

  return (await response.json()) as AgentsResponse;
}

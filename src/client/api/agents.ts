import type {
  AgentsResponse,
  ResolveAgentDefaultResponse,
  SetAgentDefaultRequest,
  SetAgentDefaultResponse,
} from "../../shared/workspace.js";

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

export async function setAgentDefault(request: SetAgentDefaultRequest): Promise<SetAgentDefaultResponse> {
  const response = await fetch("/api/agent-defaults", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Agent default API failed: ${response.status}`);
  }

  return (await response.json()) as SetAgentDefaultResponse;
}

export async function resolveAgentDefault(): Promise<ResolveAgentDefaultResponse | null> {
  const response = await fetch("/api/agent-defaults/resolve", {
    headers: {
      Accept: "application/json",
    },
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Resolve agent default API failed: ${response.status}`);
  }

  return (await response.json()) as ResolveAgentDefaultResponse;
}

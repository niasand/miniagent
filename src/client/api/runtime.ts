import type { StartRunResponse, StopRunResponse } from "../../shared/workspace.js";

export async function startSessionRun(sessionId: string): Promise<StartRunResponse> {
  const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/runs/start`, {
    method: "POST",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Runtime start API failed: ${response.status}`);
  }

  return (await response.json()) as StartRunResponse;
}

export async function stopRun(runId: string): Promise<StopRunResponse> {
  const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/stop`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ actorType: "web_user" }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Runtime stop API failed: ${response.status}`);
  }

  return (await response.json()) as StopRunResponse;
}

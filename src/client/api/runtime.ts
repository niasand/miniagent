import type { StartRunResponse } from "../../shared/workspace.js";

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

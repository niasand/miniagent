import type { CreateHandoffRequest, CreateHandoffResponse } from "../../shared/workspace.js";

export async function createHandoff(
  sessionId: string,
  request: CreateHandoffRequest,
): Promise<CreateHandoffResponse> {
  const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/handoffs`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Handoff API failed: ${response.status}`);
  }

  return (await response.json()) as CreateHandoffResponse;
}

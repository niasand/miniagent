import type { SendMessageRequest, SendMessageResponse } from "../../shared/workspace.js";

export async function sendSessionMessage(
  sessionId: string,
  request: SendMessageRequest,
): Promise<SendMessageResponse> {
  const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/messages`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Message API failed: ${response.status}`);
  }

  return (await response.json()) as SendMessageResponse;
}

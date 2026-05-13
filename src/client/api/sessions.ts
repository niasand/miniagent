import type { CreateSessionRequest, CreateSessionResponse } from "../../shared/workspace.js";

export async function createSession(request: CreateSessionRequest): Promise<CreateSessionResponse> {
  const response = await fetch("/api/sessions", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Create session API failed: ${response.status}`);
  }

  return (await response.json()) as CreateSessionResponse;
}

import type { CompactContextRequest, CompactContextResponse } from "../../shared/workspace.js";

const API_BASE = "http://127.0.0.1:7273";

export async function compactSessionContext(
  sessionId: string,
  request: CompactContextRequest = {},
): Promise<CompactContextResponse> {
  const response = await fetch(`${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/context/compact`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Compact failed: ${response.status}`);
  }

  return (await response.json()) as CompactContextResponse;
}

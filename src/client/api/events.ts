import type { QueryEventsResponse } from "../../shared/workspace.js";

export async function fetchEvents(sessionId: string, limit = 100): Promise<QueryEventsResponse> {
  const search = new URLSearchParams({
    sessionId,
    afterGlobalSeq: "0",
    limit: String(limit),
  });
  const response = await fetch(`/api/events?${search.toString()}`, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Events API failed: ${response.status}`);
  }

  return (await response.json()) as QueryEventsResponse;
}

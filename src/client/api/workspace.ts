import type { WorkspaceSnapshot } from "../../shared/workspace.js";

export async function fetchWorkspace(sessionId?: string | null): Promise<WorkspaceSnapshot> {
  const search = new URLSearchParams();
  if (sessionId) {
    search.set("sessionId", sessionId);
  }

  const response = await fetch(`/api/workspace${search.size > 0 ? `?${search.toString()}` : ""}`, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Workspace API failed: ${response.status}`);
  }

  return (await response.json()) as WorkspaceSnapshot;
}

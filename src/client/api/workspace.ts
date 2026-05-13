import type { WorkspaceSnapshot } from "../../shared/workspace.js";

export async function fetchWorkspace(): Promise<WorkspaceSnapshot> {
  const response = await fetch("/api/workspace", {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Workspace API failed: ${response.status}`);
  }

  return (await response.json()) as WorkspaceSnapshot;
}

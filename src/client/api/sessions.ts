import type { AgentType } from "./types.js";
import type { WorkspaceSnapshot } from "../../shared/workspace.js";

export type CreateSessionRequest = {
  agentType?: AgentType;
  title?: string;
  workspacePath?: string;
};

export type CreateSessionResponse = {
  sessionId: string;
};

export type UpdateSessionNameResponse = {
  sessionId: string;
  workspace: WorkspaceSnapshot;
};

export type FetchSessionsResponse = {
  sessions: WorkspaceSnapshot["sessions"];
  total: number;
  page: number;
  hasMore: boolean;
};

export async function fetchSessions(page = 1, limit = 50): Promise<FetchSessionsResponse> {
  const response = await fetch(`/api/sessions?page=${page}&limit=${limit}`);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Fetch sessions API failed: ${response.status}`);
  }
  return (await response.json()) as FetchSessionsResponse;
}

export async function createSession(request: CreateSessionRequest): Promise<CreateSessionResponse> {
  const response = await fetch("/api/sessions", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Create session API failed: ${response.status}`);
  }
  return (await response.json()) as CreateSessionResponse;
}

export async function updateSessionName(sessionId: string, name: string): Promise<UpdateSessionNameResponse> {
  const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
    method: "PATCH",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Update session API failed: ${response.status}`);
  }
  return (await response.json()) as UpdateSessionNameResponse;
}

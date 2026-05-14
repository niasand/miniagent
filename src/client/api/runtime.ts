import type {
  ListRuntimePermissionsResponse,
  RespondRuntimePermissionRequest,
  RespondRuntimePermissionResponse,
  StartRunResponse,
  StopRunResponse,
} from "../../shared/workspace.js";

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

export async function fetchRunPermissions(runId: string): Promise<ListRuntimePermissionsResponse> {
  const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/permissions`, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Runtime permissions API failed: ${response.status}`);
  }

  return (await response.json()) as ListRuntimePermissionsResponse;
}

export async function respondRunPermission(
  runId: string,
  requestId: string,
  request: RespondRuntimePermissionRequest,
): Promise<RespondRuntimePermissionResponse> {
  const response = await fetch(
    `/api/runs/${encodeURIComponent(runId)}/permissions/${encodeURIComponent(requestId)}/respond`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    },
  );

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Runtime permission response API failed: ${response.status}`);
  }

  return (await response.json()) as RespondRuntimePermissionResponse;
}

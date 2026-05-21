import type {
  CreateScheduleRequest,
  CreateScheduleResponse,
  ListScheduleRunsResponse,
  ListSchedulesResponse,
  PreviewScheduleRequest,
  PreviewScheduleResponse,
  UpdateScheduleRequest,
  UpdateScheduleResponse,
} from "../../shared/workspace.js";

export async function fetchSchedules(sessionId: string): Promise<ListSchedulesResponse> {
  const response = await fetch(`/api/schedules?sessionId=${encodeURIComponent(sessionId)}`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `List schedules API failed: ${response.status}`);
  }
  return (await response.json()) as ListSchedulesResponse;
}

export async function createSchedule(request: CreateScheduleRequest): Promise<CreateScheduleResponse> {
  const response = await fetch("/api/schedules", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Create schedule API failed: ${response.status}`);
  }
  return (await response.json()) as CreateScheduleResponse;
}

export async function previewSchedule(request: PreviewScheduleRequest): Promise<PreviewScheduleResponse> {
  const response = await fetch("/api/schedules/preview", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Preview schedule API failed: ${response.status}`);
  }
  return (await response.json()) as PreviewScheduleResponse;
}

export async function fetchScheduleRuns(scheduleId: string): Promise<ListScheduleRunsResponse> {
  const response = await fetch(`/api/schedules/${encodeURIComponent(scheduleId)}/runs`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `List schedule runs API failed: ${response.status}`);
  }
  return (await response.json()) as ListScheduleRunsResponse;
}

export async function updateSchedule(scheduleId: string, request: UpdateScheduleRequest): Promise<UpdateScheduleResponse> {
  const response = await fetch(`/api/schedules/${encodeURIComponent(scheduleId)}`, {
    method: "PATCH",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Update schedule API failed: ${response.status}`);
  }
  return (await response.json()) as UpdateScheduleResponse;
}

export async function updateScheduleStatus(
  scheduleId: string,
  action: "pause" | "resume" | "cancel",
): Promise<UpdateScheduleResponse> {
  const response = await fetch(`/api/schedules/${encodeURIComponent(scheduleId)}/${action}`, {
    method: "POST",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Update schedule API failed: ${response.status}`);
  }
  return (await response.json()) as UpdateScheduleResponse;
}

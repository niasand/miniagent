import type {
  CreateScheduleRequest,
  CreateScheduleResponse,
  ListSchedulesResponse,
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

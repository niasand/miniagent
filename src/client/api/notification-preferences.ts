import type { BindDefaultNotificationPreferenceResponse, GetDefaultNotificationPreferenceResponse } from "../../shared/workspace.js";

export async function fetchDefaultNotificationPreference(): Promise<GetDefaultNotificationPreferenceResponse> {
  const response = await fetch("/api/notification-preferences/default", {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Notification preference API failed: ${response.status}`);
  return (await response.json()) as GetDefaultNotificationPreferenceResponse;
}

export async function bindDefaultNotificationPreference(): Promise<BindDefaultNotificationPreferenceResponse> {
  const response = await fetch("/api/notification-preferences/default/bind-latest-private", {
    method: "POST",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Bind notification preference failed: ${response.status}`);
  }
  return (await response.json()) as BindDefaultNotificationPreferenceResponse;
}

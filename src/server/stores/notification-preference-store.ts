import type { SqliteDatabase } from "../db/migrate.js";
import { createId } from "../../shared/ids.js";
import { parseJson, stringifyJson } from "../../shared/json.js";
import { nowIso } from "../../shared/time.js";
import type { WorkspaceScheduleNotificationTarget } from "../../shared/workspace.js";

export type NotificationPreferenceScopeType = "user" | "system";

export type NotificationPreferenceRecord = {
  id: string;
  scopeType: NotificationPreferenceScopeType;
  scopeRef: string;
  targets: WorkspaceScheduleNotificationTarget[];
  updatedAt: string;
};

type NotificationPreferenceRow = {
  id: string;
  scope_type: NotificationPreferenceScopeType;
  scope_ref: string;
  targets_json: string;
  updated_at: string;
};

export class NotificationPreferenceStore {
  constructor(private readonly db: SqliteDatabase) {}

  get(scopeType: NotificationPreferenceScopeType, scopeRef: string): NotificationPreferenceRecord | null {
    const row = this.db.prepare(
      "SELECT * FROM notification_preferences WHERE scope_type = ? AND scope_ref = ?",
    ).get(scopeType, scopeRef) as NotificationPreferenceRow | undefined;
    return row ? mapRow(row) : null;
  }

  set(input: {
    scopeType: NotificationPreferenceScopeType;
    scopeRef: string;
    targets: WorkspaceScheduleNotificationTarget[];
  }): NotificationPreferenceRecord {
    const now = nowIso();
    const targets = input.targets.filter(isValidTarget);
    this.db.prepare(
      `INSERT INTO notification_preferences (id, scope_type, scope_ref, targets_json, created_at, updated_at)
       VALUES (@id, @scopeType, @scopeRef, @targetsJson, @createdAt, @updatedAt)
       ON CONFLICT (scope_type, scope_ref) DO UPDATE SET targets_json = @targetsJson, updated_at = @updatedAt`,
    ).run({
      id: createId("ntp"),
      scopeType: input.scopeType,
      scopeRef: input.scopeRef,
      targetsJson: stringifyJson(targets),
      createdAt: now,
      updatedAt: now,
    });
    const record = this.get(input.scopeType, input.scopeRef);
    if (!record) throw new Error("Failed to save notification preference");
    return record;
  }
}

function mapRow(row: NotificationPreferenceRow): NotificationPreferenceRecord {
  const parsed = parseJson(row.targets_json);
  const targets = Array.isArray(parsed) ? parsed.filter(isValidTarget) : [];
  return {
    id: row.id,
    scopeType: row.scope_type,
    scopeRef: row.scope_ref,
    targets,
    updatedAt: row.updated_at,
  };
}

function isValidTarget(value: unknown): value is WorkspaceScheduleNotificationTarget {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const target = value as Record<string, unknown>;
  return (target.channelType === "qq" || target.channelType === "telegram")
    && typeof target.targetRef === "string"
    && target.targetRef.trim().length > 0;
}

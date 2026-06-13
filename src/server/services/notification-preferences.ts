import type { SqliteDatabase } from "../db/migrate.js";
import { NotificationPreferenceStore, type NotificationPreferenceRecord } from "../stores/notification-preference-store.js";
import type { WorkspaceScheduleNotificationTarget } from "../../shared/workspace.js";

const DEFAULT_USER_REF = "default";

export class NotificationPreferenceService {
  private readonly store: NotificationPreferenceStore;

  constructor(private readonly db: SqliteDatabase) {
    this.store = new NotificationPreferenceStore(db);
  }

  getDefaultUserPreference(): NotificationPreferenceRecord | null {
    return this.store.get("user", DEFAULT_USER_REF);
  }

  setDefaultUserTargets(targets: WorkspaceScheduleNotificationTarget[]): NotificationPreferenceRecord {
    return this.store.set({
      scopeType: "user",
      scopeRef: DEFAULT_USER_REF,
      targets,
    });
  }

  bindDefaultUserToLatestPrivateTargets(): NotificationPreferenceRecord {
    return this.setDefaultUserTargets(this.resolveLatestPrivateTargets());
  }

  resolveTargetsForDefaultUser(): WorkspaceScheduleNotificationTarget[] {
    const preference = this.getDefaultUserPreference();
    return preference?.targets.length ? preference.targets : this.resolveLatestPrivateTargets();
  }

  resolveLatestPrivateTargets(): WorkspaceScheduleNotificationTarget[] {
    const rows = this.db.prepare(`
      SELECT channel_type, channel_ref FROM (
        SELECT
          channel_type,
          channel_ref,
          row_number() OVER (
            PARTITION BY channel_type
            ORDER BY updated_at DESC, id DESC
          ) AS row_num
        FROM sessions
        WHERE status != 'archived'
          AND (
            (channel_type = 'qq' AND channel_ref LIKE 'c2c:%')
            OR (channel_type = 'telegram' AND channel_ref LIKE 'private:%')
          )
      )
      WHERE row_num = 1
      ORDER BY CASE channel_type WHEN 'qq' THEN 0 ELSE 1 END
    `).all() as Array<{ channel_type: "qq" | "telegram"; channel_ref: string }>;

    return rows.map((row) => ({
      channelType: row.channel_type,
      targetRef: row.channel_ref,
    }));
  }
}

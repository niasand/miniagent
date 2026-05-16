import type { SqliteDatabase } from "../db/migrate.js";
import { createId } from "../../shared/ids.js";
import { stringifyJson, type JsonValue } from "../../shared/json.js";
import { nowIso } from "../../shared/time.js";

export type AuditActorType = "web_user" | "feishu_user" | "qq_user" | "telegram_user" | "discord_user" | "system" | "agent";

export type AuditLogEntry = {
  id: string;
  actorType: AuditActorType;
  actorRef: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  payload: JsonValue;
  createdAt: string;
};

export class AuditLogStore {
  constructor(private readonly db: SqliteDatabase) {}

  insert(input: {
    actorType: AuditActorType;
    actorRef?: string | null;
    action: string;
    resourceType: string;
    resourceId?: string | null;
    payload?: JsonValue;
  }): AuditLogEntry {
    const now = nowIso();
    const id = createId("aud");
    this.db.prepare(
      `INSERT INTO audit_logs (id, actor_type, actor_ref, action, resource_type, resource_id, payload_json, created_at)
       VALUES (@id, @actorType, @actorRef, @action, @resourceType, @resourceId, @payloadJson, @createdAt)`
    ).run({
      id, actorType: input.actorType, actorRef: input.actorRef ?? null,
      action: input.action, resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      payloadJson: stringifyJson(input.payload ?? {}),
      createdAt: now,
    });
    return { id, actorType: input.actorType, actorRef: input.actorRef ?? null, action: input.action, resourceType: input.resourceType, resourceId: input.resourceId ?? null, payload: input.payload ?? {}, createdAt: now };
  }
}

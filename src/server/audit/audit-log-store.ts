import type { SqliteDatabase } from "../db/migrate.js";
import { createId } from "../../shared/ids.js";
import { parseJson, stringifyJson, type JsonValue } from "../../shared/json.js";
import { nowIso } from "../../shared/time.js";
import { redactJson } from "../security/redaction.js";

export type AuditActorType = "web_user" | "feishu_user" | "qq_user" | "system" | "agent";

export type AuditLogRecord = {
  id: string;
  actorType: AuditActorType;
  actorRef: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  payload: JsonValue;
  createdAt: string;
};

export type InsertAuditLogInput = {
  id?: string;
  actorType: AuditActorType;
  actorRef?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  payload?: JsonValue;
  createdAt?: string;
};

type AuditLogRow = {
  id: string;
  actor_type: AuditActorType;
  actor_ref: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  payload_json: string;
  created_at: string;
};

export class AuditLogStore {
  constructor(private readonly db: SqliteDatabase) {}

  insert(input: InsertAuditLogInput): AuditLogRecord {
    const createdAt = input.createdAt ?? nowIso();
    const row = this.db
      .prepare(
        `
        INSERT INTO audit_logs (
          id, actor_type, actor_ref, action, resource_type, resource_id, payload_json, created_at
        )
        VALUES (
          @id, @actorType, @actorRef, @action, @resourceType, @resourceId, @payloadJson, @createdAt
        )
        RETURNING *
      `,
      )
      .get({
        id: input.id ?? createId("aud"),
        actorType: input.actorType,
        actorRef: input.actorRef ?? null,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId ?? null,
        payloadJson: stringifyJson(redactJson(input.payload ?? {})),
        createdAt,
      }) as AuditLogRow;

    return mapAuditLogRow(row);
  }

  listByResource(resourceType: string, resourceId: string): AuditLogRecord[] {
    const rows = this.db
      .prepare(
        `
        SELECT *
        FROM audit_logs
        WHERE resource_type = ? AND resource_id = ?
        ORDER BY created_at ASC, id ASC
      `,
      )
      .all(resourceType, resourceId) as AuditLogRow[];

    return rows.map(mapAuditLogRow);
  }
}

function mapAuditLogRow(row: AuditLogRow): AuditLogRecord {
  return {
    id: row.id,
    actorType: row.actor_type,
    actorRef: row.actor_ref,
    action: row.action,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    payload: parseJson(row.payload_json),
    createdAt: row.created_at,
  };
}

import type { AuditActorType } from "../audit/audit-log-store.js";
import type { SqliteDatabase } from "../db/migrate.js";
import { createId } from "../../shared/ids.js";
import { parseJson, stringifyJson, type JsonValue } from "../../shared/json.js";
import { nowIso } from "../../shared/time.js";

export type OperationConfirmationStatus = "pending" | "confirmed" | "expired" | "consumed" | "cancelled";
export type OperationRiskLevel = "medium" | "high" | "critical";

export type OperationConfirmationRecord = {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  riskLevel: OperationRiskLevel;
  prompt: string;
  payload: JsonValue;
  tokenHash: string;
  status: OperationConfirmationStatus;
  actorType: AuditActorType;
  actorRef: string | null;
  requestedAt: string;
  expiresAt: string;
  confirmedAt: string | null;
  consumedAt: string | null;
};

export type InsertOperationConfirmationInput = {
  id?: string;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  riskLevel: OperationRiskLevel;
  prompt: string;
  payload?: JsonValue;
  tokenHash: string;
  actorType: AuditActorType;
  actorRef?: string | null;
  requestedAt?: string;
  expiresAt: string;
};

type OperationConfirmationRow = {
  id: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  risk_level: OperationRiskLevel;
  prompt: string;
  payload_json: string;
  token_hash: string;
  status: OperationConfirmationStatus;
  actor_type: AuditActorType;
  actor_ref: string | null;
  requested_at: string;
  expires_at: string;
  confirmed_at: string | null;
  consumed_at: string | null;
};

export class OperationConfirmationStore {
  constructor(private readonly db: SqliteDatabase) {}

  insert(input: InsertOperationConfirmationInput): OperationConfirmationRecord {
    const row = this.db
      .prepare(
        `
        INSERT INTO operation_confirmations (
          id, action, resource_type, resource_id, risk_level, prompt, payload_json,
          token_hash, actor_type, actor_ref, requested_at, expires_at
        )
        VALUES (
          @id, @action, @resourceType, @resourceId, @riskLevel, @prompt, @payloadJson,
          @tokenHash, @actorType, @actorRef, @requestedAt, @expiresAt
        )
        RETURNING *
      `,
      )
      .get({
        id: input.id ?? createId("cnf"),
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId ?? null,
        riskLevel: input.riskLevel,
        prompt: input.prompt,
        payloadJson: stringifyJson(input.payload ?? {}),
        tokenHash: input.tokenHash,
        actorType: input.actorType,
        actorRef: input.actorRef ?? null,
        requestedAt: input.requestedAt ?? nowIso(),
        expiresAt: input.expiresAt,
      }) as OperationConfirmationRow;

    return mapOperationConfirmationRow(row);
  }

  get(id: string): OperationConfirmationRecord | null {
    const row = this.db.prepare("SELECT * FROM operation_confirmations WHERE id = ?").get(id) as
      | OperationConfirmationRow
      | undefined;

    return row ? mapOperationConfirmationRow(row) : null;
  }

  confirm(id: string, confirmedAt: string): OperationConfirmationRecord | null {
    const row = this.db
      .prepare(
        `
        UPDATE operation_confirmations
        SET status = 'confirmed', confirmed_at = @confirmedAt
        WHERE id = @id AND status = 'pending'
        RETURNING *
      `,
      )
      .get({ id, confirmedAt }) as OperationConfirmationRow | undefined;

    return row ? mapOperationConfirmationRow(row) : null;
  }

  expire(id: string): OperationConfirmationRecord | null {
    const row = this.db
      .prepare(
        `
        UPDATE operation_confirmations
        SET status = 'expired'
        WHERE id = ? AND status = 'pending'
        RETURNING *
      `,
      )
      .get(id) as OperationConfirmationRow | undefined;

    return row ? mapOperationConfirmationRow(row) : null;
  }

  consume(id: string, consumedAt: string): OperationConfirmationRecord | null {
    const row = this.db
      .prepare(
        `
        UPDATE operation_confirmations
        SET status = 'consumed', consumed_at = @consumedAt
        WHERE id = @id AND status = 'confirmed'
        RETURNING *
      `,
      )
      .get({ id, consumedAt }) as OperationConfirmationRow | undefined;

    return row ? mapOperationConfirmationRow(row) : null;
  }
}

function mapOperationConfirmationRow(row: OperationConfirmationRow): OperationConfirmationRecord {
  return {
    id: row.id,
    action: row.action,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    riskLevel: row.risk_level,
    prompt: row.prompt,
    payload: parseJson(row.payload_json),
    tokenHash: row.token_hash,
    status: row.status,
    actorType: row.actor_type,
    actorRef: row.actor_ref,
    requestedAt: row.requested_at,
    expiresAt: row.expires_at,
    confirmedAt: row.confirmed_at,
    consumedAt: row.consumed_at,
  };
}

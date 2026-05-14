import type { SqliteDatabase } from "../db/migrate.js";
import { createId } from "../../shared/ids.js";
import { stringifyJson, type JsonValue } from "../../shared/json.js";
import { addMillisecondsIso, nowIso } from "../../shared/time.js";
import { redactJson } from "../security/redaction.js";

export type OutboxChannel = "web" | "feishu";
export type OutboxKind = "web_event" | "feishu_card_create" | "feishu_card_update" | "feishu_text";
export type OutboxStatus = "pending" | "sending" | "sent" | "failed" | "dead";

export type EnqueueOutboxInput = {
  id?: string;
  sessionId: string;
  eventId?: string | null;
  eventGlobalSeq?: number | null;
  channelType: OutboxChannel;
  targetRef: string;
  kind: OutboxKind;
  viewModel: JsonValue;
  idempotencyKey: string;
  status?: OutboxStatus;
  maxAttempts?: number;
  nextAttemptAt?: string | null;
};

export type OutboxItem = {
  id: string;
  sessionId: string;
  eventId: string | null;
  eventGlobalSeq: number | null;
  channelType: OutboxChannel;
  targetRef: string;
  kind: OutboxKind;
  viewModelJson: string;
  idempotencyKey: string;
  status: OutboxStatus;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string | null;
  lockedBy: string | null;
  lockedAt: string | null;
  leaseExpiresAt: string | null;
  providerMessageId: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
};

type OutboxRow = {
  id: string;
  session_id: string;
  event_id: string | null;
  event_global_seq: number | null;
  channel_type: OutboxChannel;
  target_ref: string;
  kind: OutboxKind;
  view_model_json: string;
  idempotency_key: string;
  status: OutboxStatus;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string | null;
  locked_by: string | null;
  locked_at: string | null;
  lease_expires_at: string | null;
  provider_message_id: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
};

export class OutboxStore {
  constructor(private readonly db: SqliteDatabase) {}

  enqueue(input: EnqueueOutboxInput): OutboxItem {
    const timestamp = nowIso();
    const row = this.db
      .prepare(
        `
        INSERT INTO outbox (
          id, session_id, event_id, event_global_seq, channel_type, target_ref, kind,
          view_model_json, idempotency_key, status, max_attempts, next_attempt_at,
          created_at, updated_at
        )
        VALUES (
          @id, @sessionId, @eventId, @eventGlobalSeq, @channelType, @targetRef, @kind,
          @viewModelJson, @idempotencyKey, @status, @maxAttempts, @nextAttemptAt,
          @createdAt, @updatedAt
        )
        RETURNING *
      `,
      )
      .get({
        id: input.id ?? createId("out"),
        sessionId: input.sessionId,
        eventId: input.eventId ?? null,
        eventGlobalSeq: input.eventGlobalSeq ?? null,
        channelType: input.channelType,
        targetRef: input.targetRef,
        kind: input.kind,
        viewModelJson: stringifyJson(redactJson(input.viewModel)),
        idempotencyKey: input.idempotencyKey,
        status: input.status ?? "pending",
        maxAttempts: input.maxAttempts ?? 5,
        nextAttemptAt: input.nextAttemptAt ?? null,
        createdAt: timestamp,
        updatedAt: timestamp,
      }) as OutboxRow;

    return mapOutboxRow(row);
  }

  enqueueOnce(input: EnqueueOutboxInput): OutboxItem {
    const existing = this.getByIdempotencyKey(input.idempotencyKey);
    if (existing) {
      return existing;
    }

    return this.enqueue(input);
  }

  getByIdempotencyKey(idempotencyKey: string): OutboxItem | null {
    const row = this.db
      .prepare("SELECT * FROM outbox WHERE idempotency_key = ?")
      .get(idempotencyKey) as OutboxRow | undefined;

    return row ? mapOutboxRow(row) : null;
  }

  claimDue(options: {
    workerId: string;
    limit: number;
    leaseMs: number;
    now?: string;
    channelType?: OutboxChannel;
  }): OutboxItem[] {
    if (options.limit <= 0) {
      throw new Error("limit must be positive");
    }
    if (options.leaseMs <= 0) {
      throw new Error("leaseMs must be positive");
    }

    const timestamp = options.now ?? nowIso();
    const leaseExpiresAt = addMillisecondsIso(timestamp, options.leaseMs);
    const claim = this.db.transaction(() => {
      const rows = this.db
        .prepare(
          `
          UPDATE outbox
          SET
            status = 'sending',
            attempts = attempts + 1,
            locked_by = @workerId,
            locked_at = @now,
            lease_expires_at = @leaseExpiresAt,
            updated_at = @now
          WHERE id IN (
            SELECT id
            FROM outbox
            WHERE status IN ('pending', 'failed')
              AND (@channelType IS NULL OR channel_type = @channelType)
              AND attempts < max_attempts
              AND (next_attempt_at IS NULL OR next_attempt_at <= @now)
            ORDER BY created_at ASC, id ASC
            LIMIT @limit
          )
          RETURNING *
        `,
        )
        .all({
          workerId: options.workerId,
          now: timestamp,
          leaseExpiresAt,
          limit: options.limit,
          channelType: options.channelType ?? null,
        }) as OutboxRow[];

      return rows.map(mapOutboxRow);
    });

    return claim();
  }

  releaseExpiredLeases(now = nowIso()): number {
    const result = this.db
      .prepare(
        `
        UPDATE outbox
        SET
          status = 'pending',
          locked_by = NULL,
          locked_at = NULL,
          lease_expires_at = NULL,
          updated_at = @now
        WHERE status = 'sending'
          AND lease_expires_at IS NOT NULL
          AND lease_expires_at <= @now
      `,
      )
      .run({ now });

    return result.changes;
  }

  markSent(id: string, providerMessageId?: string | null, now = nowIso()): OutboxItem {
    const row = this.db
      .prepare(
        `
        UPDATE outbox
        SET
          status = 'sent',
          provider_message_id = @providerMessageId,
          locked_by = NULL,
          locked_at = NULL,
          lease_expires_at = NULL,
          updated_at = @now,
          sent_at = @now
        WHERE id = @id
        RETURNING *
      `,
      )
      .get({ id, providerMessageId: providerMessageId ?? null, now }) as OutboxRow | undefined;

    if (!row) {
      throw new Error(`Outbox item not found: ${id}`);
    }

    return mapOutboxRow(row);
  }

  markFailed(id: string, lastError: string, nextAttemptAt?: string | null, now = nowIso()): OutboxItem {
    const row = this.db
      .prepare(
        `
        UPDATE outbox
        SET
          status = CASE WHEN attempts >= max_attempts THEN 'dead' ELSE 'failed' END,
          last_error = @lastError,
          next_attempt_at = @nextAttemptAt,
          locked_by = NULL,
          locked_at = NULL,
          lease_expires_at = NULL,
          updated_at = @now
        WHERE id = @id
        RETURNING *
      `,
      )
      .get({ id, lastError, nextAttemptAt: nextAttemptAt ?? null, now }) as OutboxRow | undefined;

    if (!row) {
      throw new Error(`Outbox item not found: ${id}`);
    }

    return mapOutboxRow(row);
  }
}

function mapOutboxRow(row: OutboxRow): OutboxItem {
  return {
    id: row.id,
    sessionId: row.session_id,
    eventId: row.event_id,
    eventGlobalSeq: row.event_global_seq,
    channelType: row.channel_type,
    targetRef: row.target_ref,
    kind: row.kind,
    viewModelJson: row.view_model_json,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    nextAttemptAt: row.next_attempt_at,
    lockedBy: row.locked_by,
    lockedAt: row.locked_at,
    leaseExpiresAt: row.lease_expires_at,
    providerMessageId: row.provider_message_id,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sentAt: row.sent_at,
  };
}

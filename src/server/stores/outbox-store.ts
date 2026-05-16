import type { SqliteDatabase } from "../db/migrate.js";
import { createId } from "../../shared/ids.js";
import { parseJson, stringifyJson, type JsonValue } from "../../shared/json.js";
import { nowIso, addMillisecondsIso } from "../../shared/time.js";

export type OutboxChannel = "web" | "feishu" | "qq" | "telegram" | "discord";
export type OutboxKind = "web_event" | "feishu_markdown" | "qq_markdown" | "telegram_markdown" | "discord_markdown";
export type OutboxStatus = "pending" | "sending" | "sent" | "failed" | "dead";

export type OutboxItem = {
  id: string;
  sessionId: string;
  eventId: string | null;
  eventGlobalSeq: number | null;
  channelType: OutboxChannel;
  targetRef: string;
  kind: OutboxKind;
  viewModel: JsonValue;
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
  channel_type: string;
  target_ref: string;
  kind: string;
  view_model_json: string;
  idempotency_key: string;
  status: string;
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

const CLAIM_LEASE_MS = 30_000;
const BACKOFF_BASE_MS = 2_000;

export class OutboxStore {
  constructor(private readonly db: SqliteDatabase) {}

  enqueue(input: {
    sessionId: string;
    eventId?: string | null;
    eventGlobalSeq?: number | null;
    channelType: OutboxChannel;
    targetRef: string;
    kind: OutboxKind;
    viewModel?: JsonValue;
    idempotencyKey: string;
  }): OutboxItem {
    const now = nowIso();
    const row = this.db.prepare(
      `INSERT INTO outbox (id, session_id, event_id, event_global_seq, channel_type, target_ref, kind, view_model_json, idempotency_key, status, created_at, updated_at)
       VALUES (@id, @sessionId, @eventId, @eventGlobalSeq, @channelType, @targetRef, @kind, @viewModelJson, @idempotencyKey, 'pending', @createdAt, @updatedAt)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING *`
    ).get({
      id: createId("out"),
      sessionId: input.sessionId,
      eventId: input.eventId ?? null,
      eventGlobalSeq: input.eventGlobalSeq ?? null,
      channelType: input.channelType,
      targetRef: input.targetRef,
      kind: input.kind,
      viewModelJson: stringifyJson(input.viewModel ?? {}),
      idempotencyKey: input.idempotencyKey,
      createdAt: now,
      updatedAt: now,
    }) as OutboxRow | undefined;

    if (!row) {
      // Already exists due to idempotency — return the existing one
      const existing = this.db.prepare("SELECT * FROM outbox WHERE idempotency_key = ?").get(input.idempotencyKey) as OutboxRow;
      return mapOutboxRow(existing);
    }

    return mapOutboxRow(row);
  }

  claimDue(options: { workerId: string; channelType?: OutboxChannel; limit?: number }): OutboxItem[] {
    const limit = options.limit ?? 10;
    const now = nowIso();
    const leaseExpiry = addMillisecondsIso(now, CLAIM_LEASE_MS);

    let rows: OutboxRow[];
    if (options.channelType) {
      rows = this.db.prepare(
        `SELECT * FROM outbox
         WHERE status IN ('pending', 'failed')
           AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
           AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
           AND channel_type = ?
         ORDER BY created_at ASC
         LIMIT ?`
      ).all(now, now, options.channelType, limit) as OutboxRow[];
    } else {
      rows = this.db.prepare(
        `SELECT * FROM outbox
         WHERE status IN ('pending', 'failed')
           AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
           AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
         ORDER BY created_at ASC
         LIMIT ?`
      ).all(now, now, limit) as OutboxRow[];
    }

    const now2 = nowIso();
    const claimed: OutboxRow[] = [];
    for (const row of rows) {
      this.db.prepare(
        `UPDATE outbox SET status = 'sending', locked_by = @workerId, locked_at = @lockedAt, lease_expires_at = @leaseExpiresAt, updated_at = @updatedAt WHERE id = @id`
      ).run({
        id: row.id,
        workerId: options.workerId,
        lockedAt: now2,
        leaseExpiresAt: leaseExpiry,
        updatedAt: now2,
      });
      claimed.push(this.db.prepare("SELECT * FROM outbox WHERE id = ?").get(row.id) as OutboxRow);
    }

    return claimed.map(mapOutboxRow);
  }

  markSent(id: string, providerMessageId?: string): void {
    const now = nowIso();
    this.db.prepare(
      `UPDATE outbox SET status = 'sent', attempts = attempts + 1, provider_message_id = @providerMessageId, sent_at = @sentAt, updated_at = @updatedAt WHERE id = @id`
    ).run({ id, providerMessageId: providerMessageId ?? null, sentAt: now, updatedAt: now });
  }

  markFailed(id: string, error: string): void {
    const row = this.db.prepare("SELECT * FROM outbox WHERE id = ?").get(id) as OutboxRow;
    if (!row) return;

    const attempts = row.attempts + 1;
    const isDead = attempts >= row.max_attempts;
    const now = nowIso();
    const nextAttempt = isDead ? null : addMillisecondsIso(now, BACKOFF_BASE_MS * Math.pow(2, attempts - 1));

    this.db.prepare(
      `UPDATE outbox SET status = @status, attempts = @attempts, last_error = @lastError, next_attempt_at = @nextAttemptAt, locked_by = NULL, locked_at = NULL, lease_expires_at = NULL, updated_at = @updatedAt WHERE id = @id`
    ).run({
      id,
      status: isDead ? "dead" : "failed",
      attempts,
      lastError: error.slice(0, 500),
      nextAttemptAt: nextAttempt,
      updatedAt: now,
    });
  }
}

function mapOutboxRow(row: OutboxRow): OutboxItem {
  return {
    id: row.id,
    sessionId: row.session_id,
    eventId: row.event_id,
    eventGlobalSeq: row.event_global_seq,
    channelType: row.channel_type as OutboxChannel,
    targetRef: row.target_ref,
    kind: row.kind as OutboxKind,
    viewModel: parseJson(row.view_model_json),
    idempotencyKey: row.idempotency_key,
    status: row.status as OutboxStatus,
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

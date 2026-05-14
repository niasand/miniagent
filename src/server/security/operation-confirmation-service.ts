import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { AuditLogStore, type AuditActorType } from "../audit/audit-log-store.js";
import type { SqliteDatabase } from "../db/migrate.js";
import type { JsonValue } from "../../shared/json.js";
import { nowIso } from "../../shared/time.js";
import {
  OperationConfirmationStore,
  type OperationConfirmationRecord,
  type OperationRiskLevel,
} from "./operation-confirmation-store.js";

const DEFAULT_EXPIRY_MS = 10 * 60 * 1_000;

export type RequestOperationConfirmationInput = {
  action: string;
  resourceType: string;
  resourceId?: string | null;
  riskLevel: OperationRiskLevel;
  prompt?: string;
  payload?: JsonValue;
  actorType: AuditActorType;
  actorRef?: string | null;
  requestedAt?: string;
  expiresAt?: string;
  token?: string;
};

export type RequestOperationConfirmationResult = {
  confirmation: OperationConfirmationRecord;
  token: string;
};

export class OperationConfirmationService {
  private readonly auditLogs: AuditLogStore;
  private readonly confirmations: OperationConfirmationStore;

  constructor(private readonly db: SqliteDatabase) {
    this.auditLogs = new AuditLogStore(db);
    this.confirmations = new OperationConfirmationStore(db);
  }

  request(input: RequestOperationConfirmationInput): RequestOperationConfirmationResult {
    const requestedAt = input.requestedAt ?? nowIso();
    const token = input.token ?? generateToken();
    const confirmation = this.confirmations.insert({
      action: requireNonEmpty(input.action, "action"),
      resourceType: requireNonEmpty(input.resourceType, "resourceType"),
      resourceId: input.resourceId ?? null,
      riskLevel: input.riskLevel,
      prompt: input.prompt?.trim() || `Confirm ${input.action}`,
      payload: input.payload ?? {},
      tokenHash: hashToken(token),
      actorType: input.actorType,
      actorRef: input.actorRef ?? null,
      requestedAt,
      expiresAt: input.expiresAt ?? addMilliseconds(requestedAt, DEFAULT_EXPIRY_MS),
    });

    this.auditLogs.insert({
      actorType: input.actorType,
      actorRef: input.actorRef ?? null,
      action: "dangerous_confirmation_requested",
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      payload: {
        confirmationId: confirmation.id,
        action: confirmation.action,
        riskLevel: confirmation.riskLevel,
        expiresAt: confirmation.expiresAt,
      },
      createdAt: requestedAt,
    });

    return { confirmation, token };
  }

  confirm(input: { id: string; token: string; confirmedAt?: string }): OperationConfirmationRecord {
    const confirmation = this.requireConfirmation(input.id);
    const confirmedAt = input.confirmedAt ?? nowIso();

    if (confirmation.status !== "pending") {
      throw new Error(`Operation confirmation is not pending: ${input.id}`);
    }
    if (confirmedAt > confirmation.expiresAt) {
      this.confirmations.expire(input.id);
      throw new Error(`Operation confirmation expired: ${input.id}`);
    }
    if (!tokensEqual(hashToken(input.token), confirmation.tokenHash)) {
      throw new Error("Operation confirmation token is invalid");
    }

    const confirmed = this.confirmations.confirm(input.id, confirmedAt);
    if (!confirmed) {
      throw new Error(`Operation confirmation is not pending: ${input.id}`);
    }

    this.auditLogs.insert({
      actorType: confirmed.actorType,
      actorRef: confirmed.actorRef,
      action: "dangerous_confirmation_confirmed",
      resourceType: confirmed.resourceType,
      resourceId: confirmed.resourceId,
      payload: {
        confirmationId: confirmed.id,
        action: confirmed.action,
        riskLevel: confirmed.riskLevel,
      },
      createdAt: confirmedAt,
    });

    return confirmed;
  }

  consume(input: { id: string; consumedAt?: string }): OperationConfirmationRecord {
    const consumedAt = input.consumedAt ?? nowIso();
    const consumed = this.confirmations.consume(input.id, consumedAt);
    if (!consumed) {
      throw new Error(`Operation confirmation is not confirmed: ${input.id}`);
    }

    this.auditLogs.insert({
      actorType: consumed.actorType,
      actorRef: consumed.actorRef,
      action: "dangerous_confirmation_consumed",
      resourceType: consumed.resourceType,
      resourceId: consumed.resourceId,
      payload: {
        confirmationId: consumed.id,
        action: consumed.action,
        riskLevel: consumed.riskLevel,
      },
      createdAt: consumedAt,
    });

    return consumed;
  }

  private requireConfirmation(id: string): OperationConfirmationRecord {
    const confirmation = this.confirmations.get(id);
    if (!confirmation) {
      throw new Error(`Operation confirmation not found: ${id}`);
    }
    return confirmation;
  }
}

function generateToken(): string {
  return randomBytes(6).toString("hex");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function tokensEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function addMilliseconds(value: string, milliseconds: number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("requestedAt must be a valid ISO timestamp");
  }
  return new Date(date.getTime() + milliseconds).toISOString();
}

function requireNonEmpty(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${field} is required`);
  }
  return trimmed;
}

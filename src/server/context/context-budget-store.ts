import type { SqliteDatabase } from "../db/migrate.js";
import { nowIso } from "../../shared/time.js";

export type ContextBudgetStatus = "healthy" | "warning" | "critical" | "overflow";

export type ContextBudgetRecord = {
  sessionId: string;
  status: ContextBudgetStatus;
  tokenEstimate: number;
  budgetTokens: number;
  usageRatio: number;
  warningThreshold: number;
  criticalThreshold: number;
  overflowThreshold: number;
  sourceEventStartId: string | null;
  sourceEventEndId: string | null;
  sourceGlobalSeq: number;
  currentContextPackId: string | null;
  lastCompactedAt: string | null;
  overflowReason: string | null;
  updatedAt: string;
};

export type UpsertContextBudgetInput = {
  sessionId: string;
  status: ContextBudgetStatus;
  tokenEstimate: number;
  budgetTokens: number;
  usageRatio: number;
  warningThreshold: number;
  criticalThreshold: number;
  overflowThreshold: number;
  sourceEventStartId?: string | null;
  sourceEventEndId?: string | null;
  sourceGlobalSeq?: number;
  currentContextPackId?: string | null;
  lastCompactedAt?: string | null;
  overflowReason?: string | null;
  updatedAt?: string;
};

type ContextBudgetRow = {
  session_id: string;
  status: ContextBudgetStatus;
  token_estimate: number;
  budget_tokens: number;
  usage_ratio: number;
  warning_threshold: number;
  critical_threshold: number;
  overflow_threshold: number;
  source_event_start_id: string | null;
  source_event_end_id: string | null;
  source_global_seq: number;
  current_context_pack_id: string | null;
  last_compacted_at: string | null;
  overflow_reason: string | null;
  updated_at: string;
};

export class ContextBudgetStore {
  constructor(private readonly db: SqliteDatabase) {}

  get(sessionId: string): ContextBudgetRecord | null {
    const row = this.db
      .prepare("SELECT * FROM context_budgets WHERE session_id = ?")
      .get(sessionId) as ContextBudgetRow | undefined;

    return row ? mapContextBudgetRow(row) : null;
  }

  upsert(input: UpsertContextBudgetInput): ContextBudgetRecord {
    const row = this.db
      .prepare(
        `
        INSERT INTO context_budgets (
          session_id, status, token_estimate, budget_tokens, usage_ratio,
          warning_threshold, critical_threshold, overflow_threshold,
          source_event_start_id, source_event_end_id, source_global_seq,
          current_context_pack_id, last_compacted_at, overflow_reason, updated_at
        )
        VALUES (
          @sessionId, @status, @tokenEstimate, @budgetTokens, @usageRatio,
          @warningThreshold, @criticalThreshold, @overflowThreshold,
          @sourceEventStartId, @sourceEventEndId, @sourceGlobalSeq,
          @currentContextPackId, @lastCompactedAt, @overflowReason, @updatedAt
        )
        ON CONFLICT(session_id) DO UPDATE SET
          status = excluded.status,
          token_estimate = excluded.token_estimate,
          budget_tokens = excluded.budget_tokens,
          usage_ratio = excluded.usage_ratio,
          warning_threshold = excluded.warning_threshold,
          critical_threshold = excluded.critical_threshold,
          overflow_threshold = excluded.overflow_threshold,
          source_event_start_id = excluded.source_event_start_id,
          source_event_end_id = excluded.source_event_end_id,
          source_global_seq = excluded.source_global_seq,
          current_context_pack_id = excluded.current_context_pack_id,
          last_compacted_at = excluded.last_compacted_at,
          overflow_reason = excluded.overflow_reason,
          updated_at = excluded.updated_at
        RETURNING *
      `,
      )
      .get({
        sessionId: input.sessionId,
        status: input.status,
        tokenEstimate: input.tokenEstimate,
        budgetTokens: input.budgetTokens,
        usageRatio: input.usageRatio,
        warningThreshold: input.warningThreshold,
        criticalThreshold: input.criticalThreshold,
        overflowThreshold: input.overflowThreshold,
        sourceEventStartId: input.sourceEventStartId ?? null,
        sourceEventEndId: input.sourceEventEndId ?? null,
        sourceGlobalSeq: input.sourceGlobalSeq ?? 0,
        currentContextPackId: input.currentContextPackId ?? null,
        lastCompactedAt: input.lastCompactedAt ?? null,
        overflowReason: input.overflowReason ?? null,
        updatedAt: input.updatedAt ?? nowIso(),
      }) as ContextBudgetRow;

    return mapContextBudgetRow(row);
  }
}

function mapContextBudgetRow(row: ContextBudgetRow): ContextBudgetRecord {
  return {
    sessionId: row.session_id,
    status: row.status,
    tokenEstimate: row.token_estimate,
    budgetTokens: row.budget_tokens,
    usageRatio: row.usage_ratio,
    warningThreshold: row.warning_threshold,
    criticalThreshold: row.critical_threshold,
    overflowThreshold: row.overflow_threshold,
    sourceEventStartId: row.source_event_start_id,
    sourceEventEndId: row.source_event_end_id,
    sourceGlobalSeq: row.source_global_seq,
    currentContextPackId: row.current_context_pack_id,
    lastCompactedAt: row.last_compacted_at,
    overflowReason: row.overflow_reason,
    updatedAt: row.updated_at,
  };
}

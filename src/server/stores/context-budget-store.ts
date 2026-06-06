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
  sourceGlobalSeq: number;
  currentContextPackId: string | null;
  lastCompactedAt: string | null;
  overflowReason: string | null;
  updatedAt: string;
};

type ContextBudgetRow = {
  session_id: string; status: string; token_estimate: number; budget_tokens: number;
  usage_ratio: number; warning_threshold: number; critical_threshold: number;
  overflow_threshold: number; source_global_seq: number;
  current_context_pack_id: string | null; last_compacted_at: string | null;
  overflow_reason: string | null; updated_at: string;
};

export class ContextBudgetStore {
  constructor(private readonly db: SqliteDatabase) {}

  get(sessionId: string): ContextBudgetRecord | null {
    const row = this.db.prepare("SELECT * FROM context_budgets WHERE session_id = ?").get(sessionId) as ContextBudgetRow | undefined;
    return row ? mapRow(row) : null;
  }

  upsert(input: {
    sessionId: string; budgetTokens?: number;
    tokenEstimate?: number; status?: ContextBudgetStatus;
    overflowReason?: string | null;
  }): ContextBudgetRecord {
    const now = nowIso();
    const existing = this.get(input.sessionId);
    const budgetTokens = input.budgetTokens ?? existing?.budgetTokens ?? 200_000;
    const tokenEstimate = input.tokenEstimate ?? existing?.tokenEstimate ?? 0;
    const usageRatio = budgetTokens > 0 ? tokenEstimate / budgetTokens : 0;
    const status = input.status ?? classifyStatus(usageRatio, existing?.warningThreshold ?? 0.70, existing?.criticalThreshold ?? 0.85, existing?.overflowThreshold ?? 0.95);

    if (existing) {
      this.db.prepare(
        `UPDATE context_budgets SET token_estimate = @tokenEstimate, usage_ratio = @usageRatio, status = @status, budget_tokens = @budgetTokens, overflow_reason = @overflowReason, updated_at = @updatedAt WHERE session_id = @sessionId`
      ).run({ sessionId: input.sessionId, tokenEstimate, usageRatio, status, budgetTokens, overflowReason: input.overflowReason ?? existing.overflowReason, updatedAt: now });
    } else {
      this.db.prepare(
        `INSERT INTO context_budgets (session_id, status, token_estimate, budget_tokens, usage_ratio, warning_threshold, critical_threshold, overflow_threshold, source_global_seq, updated_at)
         VALUES (@sessionId, @status, @tokenEstimate, @budgetTokens, @usageRatio, 0.70, 0.85, 0.95, 0, @updatedAt)`
      ).run({ sessionId: input.sessionId, status, tokenEstimate, budgetTokens, usageRatio, updatedAt: now });
    }
    return this.get(input.sessionId)!;
  }

  setCompacted(sessionId: string, contextPackId: string, tokenEstimate: number): void {
    const now = nowIso();
    if (!this.get(sessionId)) {
      this.upsert({ sessionId, tokenEstimate });
    }
    const budget = this.get(sessionId);
    const budgetTokens = budget?.budgetTokens ?? 200_000;
    const usageRatio = budgetTokens > 0 ? tokenEstimate / budgetTokens : 0;
    this.db.prepare(
      `UPDATE context_budgets SET status = @status, token_estimate = @tokenEstimate, usage_ratio = @usageRatio, current_context_pack_id = @contextPackId, last_compacted_at = @lastCompactedAt, overflow_reason = NULL, updated_at = @updatedAt WHERE session_id = @sessionId`
    ).run({ sessionId, status: classifyStatus(usageRatio, budget?.warningThreshold ?? 0.70, budget?.criticalThreshold ?? 0.85, budget?.overflowThreshold ?? 0.95), tokenEstimate, usageRatio, contextPackId, lastCompactedAt: now, updatedAt: now });
  }
}

function classifyStatus(ratio: number, warning: number, critical: number, overflow: number): ContextBudgetStatus {
  if (ratio >= overflow) return "overflow";
  if (ratio >= critical) return "critical";
  if (ratio >= warning) return "warning";
  return "healthy";
}

function mapRow(row: ContextBudgetRow): ContextBudgetRecord {
  return {
    sessionId: row.session_id, status: row.status as ContextBudgetStatus,
    tokenEstimate: row.token_estimate, budgetTokens: row.budget_tokens,
    usageRatio: row.usage_ratio, warningThreshold: row.warning_threshold,
    criticalThreshold: row.critical_threshold, overflowThreshold: row.overflow_threshold,
    sourceGlobalSeq: row.source_global_seq,
    currentContextPackId: row.current_context_pack_id,
    lastCompactedAt: row.last_compacted_at,
    overflowReason: row.overflow_reason, updatedAt: row.updated_at,
  };
}

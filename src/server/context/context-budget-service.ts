import type { SqliteDatabase } from "../db/migrate.js";
import { EventStore, type EventRow, type StoredEvent, mapEventRow } from "../events/event-store.js";
import { nowIso } from "../../shared/time.js";
import { ContextPackService, type CreateContextPackResult } from "./context-pack-service.js";
import { ContextPackStore, type ContextPackCreatedBy, type ContextPackRecord } from "./context-pack-store.js";
import {
  ContextBudgetStore,
  type ContextBudgetRecord,
  type ContextBudgetStatus,
} from "./context-budget-store.js";

export type ContextBudgetThresholds = {
  budgetTokens?: number;
  warningThreshold?: number;
  criticalThreshold?: number;
  overflowThreshold?: number;
};

export type EvaluateContextBudgetInput = ContextBudgetThresholds & {
  sessionId: string;
  autoCompact?: boolean;
  evaluatedAt?: string;
};

export type ContextBudgetResult = {
  budget: ContextBudgetRecord;
  contextPack: ContextPackRecord | null;
  compacted: CreateContextPackResult | null;
};

export type CompactContextInput = ContextBudgetThresholds & {
  sessionId: string;
  createdBy: ContextPackCreatedBy;
  compactedAt?: string;
};

const DEFAULT_BUDGET_TOKENS = 100_000;
const DEFAULT_WARNING_THRESHOLD = 0.7;
const DEFAULT_CRITICAL_THRESHOLD = 0.85;
const DEFAULT_OVERFLOW_THRESHOLD = 0.95;
const SYSTEM_CONTEXT_EVENTS = new Set(["context_budget_changed", "context_pack_created"]);

type EventPointer = {
  id: string;
  globalSeq: number;
};

type BudgetThresholds = {
  budgetTokens: number;
  warningThreshold: number;
  criticalThreshold: number;
  overflowThreshold: number;
};

export class ContextBudgetService {
  private readonly budgets: ContextBudgetStore;
  private readonly contextPacks: ContextPackStore;
  private readonly contextPackService: ContextPackService;
  private readonly events: EventStore;

  constructor(private readonly db: SqliteDatabase, events = new EventStore(db)) {
    this.budgets = new ContextBudgetStore(db);
    this.contextPacks = new ContextPackStore(db);
    this.contextPackService = new ContextPackService(db, events);
    this.events = events;
  }

  get(sessionId: string): ContextBudgetRecord | null {
    this.requireSession(sessionId);
    return this.budgets.get(sessionId);
  }

  evaluate(input: EvaluateContextBudgetInput): ContextBudgetResult {
    this.requireSession(input.sessionId);

    const previous = this.budgets.get(input.sessionId);
    const thresholds = resolveThresholds(input, previous);
    const timestamp = input.evaluatedAt ?? nowIso();
    let contextPack = this.contextPacks.getLatestReady(input.sessionId);
    let compacted: CreateContextPackResult | null = null;
    let estimate = this.estimate(input.sessionId, contextPack, thresholds);

    if (input.autoCompact !== false && shouldCompact(estimate.status) && shouldCreatePack(contextPack, estimate.end)) {
      compacted = this.createContextPack(input.sessionId, "system", timestamp, estimate.start, estimate.end);
      contextPack = compacted.contextPack;
      estimate = this.estimate(input.sessionId, contextPack, thresholds);
    }

    const budget = this.persistBudget({
      previous,
      sessionId: input.sessionId,
      estimate,
      thresholds,
      contextPack,
      timestamp,
      compacted,
    });

    return { budget, contextPack, compacted };
  }

  compactNow(input: CompactContextInput): ContextBudgetResult {
    this.requireSession(input.sessionId);

    const previous = this.budgets.get(input.sessionId);
    const thresholds = resolveThresholds(input, previous);
    const timestamp = input.compactedAt ?? nowIso();
    const range = this.readPackableRange(input.sessionId);
    if (!range.start || !range.end) {
      throw new Error(`No events found for context pack session: ${input.sessionId}`);
    }

    const compacted = this.createContextPack(input.sessionId, input.createdBy, timestamp, range.start, range.end);
    const estimate = this.estimate(input.sessionId, compacted.contextPack, thresholds);
    const budget = this.persistBudget({
      previous,
      sessionId: input.sessionId,
      estimate,
      thresholds,
      contextPack: compacted.contextPack,
      timestamp,
      compacted,
    });

    return { budget, contextPack: compacted.contextPack, compacted };
  }

  private createContextPack(
    sessionId: string,
    createdBy: ContextPackCreatedBy,
    createdAt: string,
    start: EventPointer | null,
    end: EventPointer | null,
  ): CreateContextPackResult {
    if (!start || !end) {
      throw new Error(`No events found for context pack session: ${sessionId}`);
    }

    return this.contextPackService.createFromEvents({
      sessionId,
      sourceEventStartId: start.id,
      sourceEventEndId: end.id,
      createdBy,
      strategy: "miniagent_summary",
      createdAt,
    });
  }

  private estimate(
    sessionId: string,
    contextPack: ContextPackRecord | null,
    thresholds: BudgetThresholds,
  ): {
    tokenEstimate: number;
    usageRatio: number;
    status: ContextBudgetStatus;
    start: EventPointer | null;
    end: EventPointer | null;
  } {
    const packEnd = contextPack ? this.readEventPointer(contextPack.sourceEventEndId) : null;
    const events = this.readPackableEventsAfter(sessionId, packEnd?.globalSeq ?? 0);
    const packTokens = contextPack?.tokenEstimate ?? 0;
    const eventTokens = estimateEventTokens(events);
    const tokenEstimate = packTokens + eventTokens;
    const usageRatio = tokenEstimate / thresholds.budgetTokens;

    return {
      tokenEstimate,
      usageRatio,
      status: classifyStatus(usageRatio, thresholds),
      start: events[0] ? toPointer(events[0]) : this.readPackableRange(sessionId).start,
      end: events.at(-1) ? toPointer(events.at(-1) as StoredEvent) : packEnd,
    };
  }

  private persistBudget(input: {
    previous: ContextBudgetRecord | null;
    sessionId: string;
    estimate: {
      tokenEstimate: number;
      usageRatio: number;
      status: ContextBudgetStatus;
      start: EventPointer | null;
      end: EventPointer | null;
    };
    thresholds: BudgetThresholds;
    contextPack: ContextPackRecord | null;
    timestamp: string;
    compacted: CreateContextPackResult | null;
  }): ContextBudgetRecord {
    const persist = this.db.transaction(() => {
      const budget = this.budgets.upsert({
        sessionId: input.sessionId,
        status: input.estimate.status,
        tokenEstimate: input.estimate.tokenEstimate,
        budgetTokens: input.thresholds.budgetTokens,
        usageRatio: input.estimate.usageRatio,
        warningThreshold: input.thresholds.warningThreshold,
        criticalThreshold: input.thresholds.criticalThreshold,
        overflowThreshold: input.thresholds.overflowThreshold,
        sourceEventStartId: input.estimate.start?.id ?? null,
        sourceEventEndId: input.estimate.end?.id ?? null,
        sourceGlobalSeq: input.estimate.end?.globalSeq ?? 0,
        currentContextPackId: input.contextPack?.id ?? null,
        lastCompactedAt: input.compacted?.contextPack.createdAt ?? input.previous?.lastCompactedAt ?? null,
        overflowReason: input.estimate.status === "overflow" ? "context budget threshold exceeded" : null,
        updatedAt: input.timestamp,
      });

      if (shouldAppendBudgetEvent(input.previous, budget)) {
        this.events.append({
          sessionId: input.sessionId,
          type: "context_budget_changed",
          payload: {
            previousStatus: input.previous?.status ?? null,
            status: budget.status,
            tokenEstimate: budget.tokenEstimate,
            budgetTokens: budget.budgetTokens,
            usageRatio: budget.usageRatio,
            warningThreshold: budget.warningThreshold,
            criticalThreshold: budget.criticalThreshold,
            overflowThreshold: budget.overflowThreshold,
            currentContextPackId: budget.currentContextPackId,
            sourceEventEndId: budget.sourceEventEndId,
            compactedContextPackId: input.compacted?.contextPack.id ?? null,
          },
          createdAt: input.timestamp,
        });
      }

      return budget;
    });

    return persist();
  }

  private readPackableEventsAfter(sessionId: string, afterGlobalSeq: number): StoredEvent[] {
    const rows = this.db
      .prepare(
        `
        SELECT *
        FROM events
        WHERE session_id = ? AND global_seq > ?
        ORDER BY global_seq ASC
      `,
      )
      .all(sessionId, afterGlobalSeq) as EventRow[];

    return rows.map(mapEventRow).filter((event) => !SYSTEM_CONTEXT_EVENTS.has(event.type));
  }

  private readPackableRange(sessionId: string): { start: EventPointer | null; end: EventPointer | null } {
    const rows = this.db
      .prepare(
        `
        SELECT id, global_seq
        FROM events
        WHERE session_id = ?
          AND type NOT IN ('context_budget_changed', 'context_pack_created')
        ORDER BY global_seq ASC
      `,
      )
      .all(sessionId) as Array<{ id: string; global_seq: number }>;

    if (rows.length === 0) {
      return { start: null, end: null };
    }

    return {
      start: { id: rows[0].id, globalSeq: rows[0].global_seq },
      end: { id: rows[rows.length - 1].id, globalSeq: rows[rows.length - 1].global_seq },
    };
  }

  private readEventPointer(eventId: string): EventPointer {
    const row = this.db.prepare("SELECT id, global_seq FROM events WHERE id = ?").get(eventId) as
      | { id: string; global_seq: number }
      | undefined;

    if (!row) {
      throw new Error(`Context event not found: ${eventId}`);
    }

    return { id: row.id, globalSeq: row.global_seq };
  }

  private requireSession(sessionId: string): void {
    const row = this.db.prepare("SELECT id FROM sessions WHERE id = ?").get(sessionId) as { id: string } | undefined;
    if (!row) {
      throw new Error(`Session not found: ${sessionId}`);
    }
  }
}

function resolveThresholds(input: ContextBudgetThresholds, previous: ContextBudgetRecord | null): BudgetThresholds {
  const thresholds = {
    budgetTokens: input.budgetTokens ?? previous?.budgetTokens ?? DEFAULT_BUDGET_TOKENS,
    warningThreshold: input.warningThreshold ?? previous?.warningThreshold ?? DEFAULT_WARNING_THRESHOLD,
    criticalThreshold: input.criticalThreshold ?? previous?.criticalThreshold ?? DEFAULT_CRITICAL_THRESHOLD,
    overflowThreshold: input.overflowThreshold ?? previous?.overflowThreshold ?? DEFAULT_OVERFLOW_THRESHOLD,
  };

  if (thresholds.budgetTokens <= 0) {
    throw new Error("budgetTokens must be positive");
  }
  if (
    thresholds.warningThreshold <= 0 ||
    thresholds.warningThreshold >= thresholds.criticalThreshold ||
    thresholds.criticalThreshold >= thresholds.overflowThreshold ||
    thresholds.overflowThreshold > 1
  ) {
    throw new Error("context budget thresholds are invalid");
  }

  return thresholds;
}

function shouldCompact(status: ContextBudgetStatus): boolean {
  return status === "critical" || status === "overflow";
}

function shouldCreatePack(contextPack: ContextPackRecord | null, end: EventPointer | null): boolean {
  return Boolean(end && contextPack?.sourceEventEndId !== end.id);
}

function classifyStatus(usageRatio: number, thresholds: BudgetThresholds): ContextBudgetStatus {
  if (usageRatio >= thresholds.overflowThreshold) {
    return "overflow";
  }
  if (usageRatio >= thresholds.criticalThreshold) {
    return "critical";
  }
  if (usageRatio >= thresholds.warningThreshold) {
    return "warning";
  }
  return "healthy";
}

function estimateEventTokens(events: StoredEvent[]): number {
  if (events.length === 0) {
    return 0;
  }

  const payload = events.map((event) => ({
    type: event.type,
    payload: event.payload,
  }));
  return Math.max(1, Math.ceil(JSON.stringify(payload).length / 4));
}

function shouldAppendBudgetEvent(previous: ContextBudgetRecord | null, next: ContextBudgetRecord): boolean {
  if (!previous) {
    return true;
  }

  const estimateDelta = Math.abs(previous.tokenEstimate - next.tokenEstimate);
  const materialDelta = estimateDelta >= Math.max(50, Math.floor(next.budgetTokens * 0.01));

  return (
    previous.status !== next.status ||
    previous.currentContextPackId !== next.currentContextPackId ||
    previous.sourceEventEndId !== next.sourceEventEndId ||
    materialDelta
  );
}

function toPointer(event: StoredEvent): EventPointer {
  return { id: event.id, globalSeq: event.globalSeq };
}

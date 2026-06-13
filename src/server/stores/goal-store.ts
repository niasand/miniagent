import type { SqliteDatabase } from "../db/migrate.js";
import { createId } from "../../shared/ids.js";
import { nowIso } from "../../shared/time.js";
import { parseJson, stringifyJson } from "../../shared/json.js";

export type GoalStatus = "active" | "paused" | "completed" | "cleared";

export type GoalRecord = {
  id: string;
  sessionId: string;
  objective: string;
  status: GoalStatus;
  turnCount: number;
  maxTurns: number;
  subgoals: string[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

type GoalRow = {
  id: string;
  session_id: string;
  objective: string;
  status: GoalStatus;
  turn_count: number;
  max_turns: number;
  subgoals_json: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export class GoalStore {
  constructor(private readonly db: SqliteDatabase) {}

  set(input: { sessionId: string; objective: string; maxTurns?: number }): GoalRecord {
    const now = nowIso();
    const row = this.db.prepare(
      `INSERT INTO agent_goals (id, session_id, objective, status, turn_count, max_turns, subgoals_json, created_at, updated_at)
       VALUES (@id, @sessionId, @objective, 'active', 0, @maxTurns, '[]', @createdAt, @updatedAt)
       ON CONFLICT(session_id) DO UPDATE SET
         objective = excluded.objective,
         status = 'active',
         turn_count = 0,
         max_turns = excluded.max_turns,
         subgoals_json = '[]',
         updated_at = excluded.updated_at,
         completed_at = NULL
       RETURNING *`
    ).get({
      id: createId("mem"),
      sessionId: input.sessionId,
      objective: input.objective.trim(),
      maxTurns: input.maxTurns ?? 20,
      createdAt: now,
      updatedAt: now,
    }) as GoalRow;
    return mapGoal(row);
  }

  get(sessionId: string): GoalRecord | null {
    const row = this.db.prepare("SELECT * FROM agent_goals WHERE session_id = ?").get(sessionId) as GoalRow | undefined;
    return row ? mapGoal(row) : null;
  }

  updateStatus(sessionId: string, status: GoalStatus): GoalRecord | null {
    const now = nowIso();
    const completedAt = status === "completed" || status === "cleared" ? now : null;
    this.db.prepare(
      "UPDATE agent_goals SET status = @status, updated_at = @updatedAt, completed_at = @completedAt WHERE session_id = @sessionId"
    ).run({ sessionId, status, updatedAt: now, completedAt });
    return this.get(sessionId);
  }

  addSubgoal(sessionId: string, subgoal: string): GoalRecord | null {
    const existing = this.get(sessionId);
    if (!existing) return null;
    const subgoals = [...existing.subgoals, subgoal.trim()].filter(Boolean);
    this.db.prepare(
      "UPDATE agent_goals SET subgoals_json = @subgoalsJson, updated_at = @updatedAt WHERE session_id = @sessionId"
    ).run({ sessionId, subgoalsJson: stringifyJson(subgoals), updatedAt: nowIso() });
    return this.get(sessionId);
  }

  incrementTurn(sessionId: string): GoalRecord | null {
    this.db.prepare(
      "UPDATE agent_goals SET turn_count = turn_count + 1, updated_at = @updatedAt WHERE session_id = @sessionId AND status = 'active'"
    ).run({ sessionId, updatedAt: nowIso() });
    return this.get(sessionId);
  }
}

function mapGoal(row: GoalRow): GoalRecord {
  const parsed = parseJson(row.subgoals_json);
  return {
    id: row.id,
    sessionId: row.session_id,
    objective: row.objective,
    status: row.status,
    turnCount: row.turn_count,
    maxTurns: row.max_turns,
    subgoals: Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

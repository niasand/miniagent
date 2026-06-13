import type { SqliteDatabase } from "../db/migrate.js";
import { createId } from "../../shared/ids.js";
import { nowIso } from "../../shared/time.js";

export type DelegationStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type DelegationRecord = {
  id: string;
  parentSessionId: string;
  childSessionId: string;
  childTaskId: string;
  goal: string;
  context: string;
  status: DelegationStatus;
  createdAt: string;
  updatedAt: string;
};

type DelegationRow = {
  id: string;
  parent_session_id: string;
  child_session_id: string;
  child_task_id: string;
  goal: string;
  context: string;
  status: DelegationStatus;
  created_at: string;
  updated_at: string;
};

export class DelegationStore {
  constructor(private readonly db: SqliteDatabase) {}

  create(input: {
    parentSessionId: string;
    childSessionId: string;
    childTaskId: string;
    goal: string;
    context?: string;
  }): DelegationRecord {
    const now = nowIso();
    const row = this.db.prepare(
      `INSERT INTO agent_delegations (id, parent_session_id, child_session_id, child_task_id, goal, context, created_at, updated_at)
       VALUES (@id, @parentSessionId, @childSessionId, @childTaskId, @goal, @context, @createdAt, @updatedAt)
       RETURNING *`
    ).get({
      id: createId("tsk"),
      parentSessionId: input.parentSessionId,
      childSessionId: input.childSessionId,
      childTaskId: input.childTaskId,
      goal: input.goal,
      context: input.context ?? "",
      createdAt: now,
      updatedAt: now,
    }) as DelegationRow;
    return mapDelegation(row);
  }

  listByParent(parentSessionId: string, limit = 20): DelegationRecord[] {
    const rows = this.db.prepare(
      "SELECT * FROM agent_delegations WHERE parent_session_id = ? ORDER BY created_at DESC LIMIT ?"
    ).all(parentSessionId, limit) as DelegationRow[];
    return rows.map(mapDelegation);
  }
}

function mapDelegation(row: DelegationRow): DelegationRecord {
  return {
    id: row.id,
    parentSessionId: row.parent_session_id,
    childSessionId: row.child_session_id,
    childTaskId: row.child_task_id,
    goal: row.goal,
    context: row.context,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

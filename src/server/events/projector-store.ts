import type { SqliteDatabase } from "../db/migrate.js";
import { type EventRow, type StoredEvent, mapEventRow } from "./event-store.js";
import { nowIso } from "../../shared/time.js";

export type ProjectorOffset = {
  projectorName: string;
  lastGlobalSeq: number;
  lastEventId: string | null;
  updatedAt: string | null;
};

export type ProjectBatchResult = {
  processed: number;
  lastGlobalSeq: number;
  lastEventId: string | null;
};

type ProjectorOffsetRow = {
  projector_name: string;
  last_global_seq: number;
  last_event_id: string | null;
  updated_at: string | null;
};

export class ProjectorStore {
  constructor(private readonly db: SqliteDatabase) {}

  getOffset(projectorName: string): ProjectorOffset {
    const row = this.db
      .prepare("SELECT * FROM projector_offsets WHERE projector_name = ?")
      .get(projectorName) as ProjectorOffsetRow | undefined;

    if (!row) {
      return {
        projectorName,
        lastGlobalSeq: 0,
        lastEventId: null,
        updatedAt: null,
      };
    }

    return mapProjectorOffsetRow(row);
  }

  readEventBatch(projectorName: string, limit: number): StoredEvent[] {
    if (limit <= 0) {
      throw new Error("limit must be positive");
    }

    const offset = this.getOffset(projectorName);
    const rows = this.db
      .prepare(
        `
        SELECT *
        FROM events
        WHERE global_seq > ?
        ORDER BY global_seq ASC
        LIMIT ?
      `,
      )
      .all(offset.lastGlobalSeq, limit) as EventRow[];

    return rows.map(mapEventRow);
  }

  advanceOffset(projectorName: string, event: StoredEvent, updatedAt = nowIso()): void {
    this.db
      .prepare(
        `
        INSERT INTO projector_offsets (projector_name, last_global_seq, last_event_id, updated_at)
        VALUES (@projectorName, @lastGlobalSeq, @lastEventId, @updatedAt)
        ON CONFLICT(projector_name) DO UPDATE SET
          last_global_seq = excluded.last_global_seq,
          last_event_id = excluded.last_event_id,
          updated_at = excluded.updated_at
        WHERE excluded.last_global_seq >= projector_offsets.last_global_seq
      `,
      )
      .run({
        projectorName,
        lastGlobalSeq: event.globalSeq,
        lastEventId: event.id,
        updatedAt,
      });
  }

  projectBatch(
    projectorName: string,
    options: { limit: number },
    project: (events: StoredEvent[]) => void,
  ): ProjectBatchResult {
    const runProjector = this.db.transaction(() => {
      const events = this.readEventBatch(projectorName, options.limit);
      if (events.length === 0) {
        const offset = this.getOffset(projectorName);
        return {
          processed: 0,
          lastGlobalSeq: offset.lastGlobalSeq,
          lastEventId: offset.lastEventId,
        };
      }

      project(events);

      const lastEvent = events[events.length - 1];
      this.advanceOffset(projectorName, lastEvent);

      return {
        processed: events.length,
        lastGlobalSeq: lastEvent.globalSeq,
        lastEventId: lastEvent.id,
      };
    });

    return runProjector();
  }
}

function mapProjectorOffsetRow(row: ProjectorOffsetRow): ProjectorOffset {
  return {
    projectorName: row.projector_name,
    lastGlobalSeq: row.last_global_seq,
    lastEventId: row.last_event_id,
    updatedAt: row.updated_at,
  };
}

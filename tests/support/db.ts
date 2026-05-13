import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate, openDatabase, type SqliteDatabase } from "../../src/server/db/migrate.js";

export type TestDatabase = {
  db: SqliteDatabase;
  close: () => void;
};

export function createTestDatabase(): TestDatabase {
  const tempDir = mkdtempSync(join(tmpdir(), "miniagent-db-"));
  const db = openDatabase(join(tempDir, "miniagent.sqlite"));
  migrate(db);

  return {
    db,
    close: () => {
      db.close();
      rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

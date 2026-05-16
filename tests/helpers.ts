import Database from "better-sqlite3";
import { migrate, defaultMigrationsDir, type SqliteDatabase } from "../src/server/db/migrate.js";

export function createTestDb(): SqliteDatabase {
  const db = new Database(":memory:");
  migrate(db, defaultMigrationsDir);
  return db;
}

export function disposeTestDb(db: SqliteDatabase): void {
  db.close();
}

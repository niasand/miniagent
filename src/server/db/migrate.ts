import Database from "better-sqlite3";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export type SqliteDatabase = Database.Database;

const DEFAULT_DB_PATH = "data/miniagent.sqlite";
const MIGRATION_EXT = ".sql";

const currentDir = dirname(fileURLToPath(import.meta.url));
export const defaultMigrationsDir = join(currentDir, "migrations");

export function openDatabase(filename = process.env.MINIAGENT_DB_PATH ?? DEFAULT_DB_PATH): SqliteDatabase {
  if (filename !== ":memory:") {
    mkdirSync(dirname(resolve(filename)), { recursive: true });
  }

  const db = new Database(filename);
  applyPragmas(db);
  return db;
}

export function applyPragmas(db: SqliteDatabase): void {
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
}

export function migrate(db: SqliteDatabase, migrationsDir = defaultMigrationsDir): void {
  applyPragmas(db);
  ensureMigrationsTable(db);

  const applied = new Set(
    db
      .prepare("SELECT version FROM schema_migrations ORDER BY version")
      .all()
      .map((row) => (row as { version: string }).version),
  );

  const files = readdirSync(migrationsDir)
    .filter((file) => file.endsWith(MIGRATION_EXT))
    .sort();

  for (const file of files) {
    const version = file.slice(0, -MIGRATION_EXT.length);
    if (applied.has(version)) {
      continue;
    }

    const sql = readFileSync(join(migrationsDir, file), "utf8");
    const runMigration = db.transaction(() => {
      db.exec(sql);
      db.prepare(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
      ).run(version);
    });

    runMigration();
    applied.add(version);
  }
}

function ensureMigrationsTable(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const db = openDatabase();
  migrate(db);
  db.close();
  console.log("Database migrations applied");
}

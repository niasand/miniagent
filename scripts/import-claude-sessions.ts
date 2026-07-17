#!/usr/bin/env tsx
/**
 * Import historical Claude Code sessions into MiniAgent.
 *
 * Usage:
 *   --dry-run: Scan and report without writing to DB
 *   (no args): Perform actual import
 *
 * Data source: ~/.claude/projects (each jsonl file = one session)
 */

import { openDatabase } from "../src/server/db/migrate.js";
type SqliteDatabase = ReturnType<typeof openDatabase>;
import { SessionStore } from "../src/server/stores/session-store.js";
import { MessageStore } from "../src/server/stores/message-store.js";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

// Claude session record types
type ClaudeMessage = {
  role: "user" | "assistant";
  content: string | Array<{ type: string; text?: string; tool_use_id?: string }>;
};

type ClaudeRecord = {
  type: string;
  uuid?: string;
  sessionId?: string;
  timestamp?: string;
  cwd?: string;
  message?: ClaudeMessage;
};

interface ImportStats {
  totalFiles: number;
  skippedEmpty: number;
  skippedDuplicate: number;
  imported: number;
  failed: number;
  totalMessages: number;
  errors: Array<{ file: string; error: string }>;
}

// Extract text content from message.content
function extractTextContent(content: ClaudeMessage["content"]): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter((item) => item.type === "text" && typeof item.text === "string")
      .map((item) => item.text)
      .join("\n\n");
  }
  return "";
}

// Parse a single jsonl file and extract user/assistant messages
function parseJsonlFile(filePath: string): {
  sessionId: string;
  cwd: string | null;
  firstUserMessage: string | null;
  messages: Array<{ uuid: string; role: string; content: string; timestamp: string }>;
} | null {
  const content = readFileSync(filePath, "utf8");
  const lines = content.split("\n").filter((line) => line.trim());

  let cwd: string | null = null;
  let firstUserMessage: string | null = null;
  let firstTimestamp: string | null = null;
  const messages: Array<{ uuid: string; role: string; content: string; timestamp: string }> = [];

  for (const line of lines) {
    try {
      const record: ClaudeRecord = JSON.parse(line);

      // Capture cwd from any record
      if (record.cwd && !cwd) {
        cwd = record.cwd;
      }

      // Only process user/assistant messages
      if (record.type === "user" || record.type === "assistant") {
        if (!record.message || !record.uuid || !record.timestamp) {
          continue;
        }

        const textContent = extractTextContent(record.message.content);
        if (!textContent.trim()) {
          continue;
        }

        // Capture first user message for session title
        if (record.type === "user" && !firstUserMessage) {
          firstUserMessage = textContent;
          firstTimestamp = record.timestamp;
        }

        messages.push({
          uuid: record.uuid,
          role: record.type === "user" ? "user" : "assistant",
          content: textContent,
          timestamp: record.timestamp,
        });
      }
    } catch {
      // Skip malformed lines
      continue;
    }
  }

  if (messages.length === 0) {
    return null;
  }

  const sessionId = filePath.split("/").pop()?.replace(".jsonl", "") || "";
  return {
    sessionId,
    cwd,
    firstUserMessage,
    messages,
  };
}

// Truncate text for session title
function truncateTitle(text: string | null, maxLength = 60): string {
  if (!text) {
    return "Imported Claude Session";
  }
  const cleaned = text.split("\n")[0].trim();
  return cleaned.length > maxLength ? cleaned.slice(0, maxLength) + "..." : cleaned;
}

// Find all jsonl files in ~/.claude/projects
function findJsonlFiles(): string[] {
  const projectsDir = join(process.env.HOME || "", ".claude/projects");
  if (!existsSync(projectsDir)) {
    console.error(`Claude projects directory not found: ${projectsDir}`);
    return [];
  }

  const files: string[] = [];
  const projectDirs = readdirSync(projectsDir, { withFileTypes: true });

  for (const dir of projectDirs) {
    if (!dir.isDirectory()) {
      continue;
    }

    const projectPath = join(projectsDir, dir.name);
    try {
      const entries = readdirSync(projectPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".jsonl")) {
          files.push(join(projectPath, entry.name));
        }
      }
    } catch {
      // Skip directories we can't read
      continue;
    }
  }

  return files;
}

// Main import logic
async function importSessions(dryRun: boolean): Promise<ImportStats> {
  const dbPath = process.env.MINIAGENT_DB_PATH || "data/miniagent.sqlite";
  const db = openDatabase(dbPath);

  const sessionStore = new SessionStore(db);
  const messageStore = new MessageStore(db);

  const stats: ImportStats = {
    totalFiles: 0,
    skippedEmpty: 0,
    skippedDuplicate: 0,
    imported: 0,
    failed: 0,
    totalMessages: 0,
    errors: [],
  };

  const jsonlFiles = findJsonlFiles();
  stats.totalFiles = jsonlFiles.length;

  console.log(`Found ${jsonlFiles.length} session files to process.`);

  const BATCH_SIZE = 20;

  for (let i = 0; i < jsonlFiles.length; i += BATCH_SIZE) {
    const batch = jsonlFiles.slice(i, i + BATCH_SIZE);
    console.log(`\nProcessing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(jsonlFiles.length / BATCH_SIZE)}...`);

    for (const filePath of batch) {
      try {
        const parsed = parseJsonlFile(filePath);
        if (!parsed) {
          stats.skippedEmpty++;
          continue;
        }

        const { sessionId, cwd, firstUserMessage, messages } = parsed;

        // Check duplicate by external_session_id
        const existingRun = db
          .prepare("SELECT id FROM agent_runs WHERE external_session_id = ? LIMIT 1")
          .get(sessionId) as { id: string } | undefined;

        if (existingRun) {
          stats.skippedDuplicate++;
          continue;
        }

        if (dryRun) {
          stats.imported++;
          stats.totalMessages += messages.length;
          console.log(`  Would import: ${sessionId} (${messages.length} messages)`);
          continue;
        }

        // Import with retry for DB lock
        let attempts = 0;
        const MAX_ATTEMPTS = 3;

        while (attempts < MAX_ATTEMPTS) {
          try {
            // Create session
            const session = sessionStore.createSession({
              title: truncateTitle(firstUserMessage),
              agentType: "claude",
              workspacePath: cwd || "/unknown",
              channelType: "web",
            });

            // Insert agent_run with external_session_id
            const runId = `run_import_${sessionId}`;
            const timestamps = messages.map((m) => m.timestamp).filter(Boolean);
            const startedAt = timestamps[0] || new Date().toISOString();
            const stoppedAt = timestamps[timestamps.length - 1] || startedAt;

            db.prepare(
              `INSERT INTO agent_runs (id, session_id, task_id, agent_type, status, launch_spec_json, pid,
                runtime_kind, external_session_id, checkpoint_id, protocol_state_json, cancel_state,
                context_pack_id, heartbeat_at, started_at, stopped_at, created_at, updated_at)
               VALUES (@id, @sessionId, NULL, 'claude', 'succeeded', '{}', NULL,
                'acp', @externalSessionId, NULL, '{}', NULL,
                NULL, @heartbeatAt, @startedAt, @stoppedAt, @createdAt, @updatedAt)`
            ).run({
              id: runId,
              sessionId: session.id,
              externalSessionId: sessionId,
              heartbeatAt: stoppedAt,
              startedAt,
              stoppedAt,
              createdAt: startedAt,
              updatedAt: stoppedAt,
            });

            // Backfill session timestamps to the conversation's real time.
            // createSession stamps now(); the card stream sorts by sessions.updated_at,
            // so without this every imported session clusters at "today".
            db.prepare(
              "UPDATE sessions SET created_at = @createdAt, updated_at = @updatedAt WHERE id = @sessionId"
            ).run({ sessionId: session.id, createdAt: startedAt, updatedAt: stoppedAt });

            // Insert messages
            for (const msg of messages) {
              messageStore.insert({
                sessionId: session.id,
                role: msg.role as "user" | "assistant",
                content: msg.content,
                sourceEventId: msg.uuid,
                createdAt: msg.timestamp,
              });
            }

            stats.imported++;
            stats.totalMessages += messages.length;
            console.log(`  Imported: ${sessionId} -> ${session.id} (${messages.length} messages)`);
            break;
          } catch (err: unknown) {
            attempts++;
            if (err instanceof Error && err.message.includes("database is locked")) {
              if (attempts >= MAX_ATTEMPTS) {
                throw err;
              }
              // Wait before retry
              await new Promise((resolve) => setTimeout(resolve, 100 * attempts));
            } else {
              throw err;
            }
          }
        }
      } catch (err: unknown) {
        stats.failed++;
        const error = err instanceof Error ? err.message : String(err);
        stats.errors.push({ file: filePath, error });
        console.error(`  Failed to import ${filePath}: ${error}`);
      }
    }

    if (!dryRun) {
      console.log(`Batch complete. Progress: ${stats.imported} imported, ${stats.skippedDuplicate} skipped`);
    }
  }

  db.close();
  return stats;
}

// CLI entry point
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");

if (dryRun) {
  console.log("=== DRY RUN MODE ===\n");
}

const stats = await importSessions(dryRun);

console.log("\n=== FINAL REPORT ===");
console.log(`Total files scanned: ${stats.totalFiles}`);
console.log(`Skipped (empty): ${stats.skippedEmpty}`);
console.log(`Skipped (duplicate): ${stats.skippedDuplicate}`);
if (dryRun) {
  console.log(`Would import: ${stats.imported}`);
} else {
  console.log(`Imported: ${stats.imported}`);
}
console.log(`Total messages: ${stats.totalMessages}`);
console.log(`Failed: ${stats.failed}`);

if (stats.errors.length > 0) {
  console.log("\n=== ERRORS ===");
  for (const err of stats.errors.slice(0, 10)) {
    console.error(`  ${err.file}: ${err.error}`);
  }
  if (stats.errors.length > 10) {
    console.error(`  ... and ${stats.errors.length - 10} more errors`);
  }
}

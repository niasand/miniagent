import type { SqliteDatabase } from "../db/migrate.js";
import { MessageProjector, WebOutboxProjector, type ProjectorOptions } from "./projectors.js";

export type ProjectReadModelsResult = {
  messagesProcessed: number;
  webOutboxProcessed: number;
};

export function projectReadModelsUntilIdle(
  db: SqliteDatabase,
  options: ProjectorOptions & { maxBatches?: number } = {},
): ProjectReadModelsResult {
  const batchSize = options.batchSize ?? 100;
  const maxBatches = options.maxBatches ?? 20;
  const messages = new MessageProjector(db);
  const webOutbox = new WebOutboxProjector(db);
  let messagesProcessed = 0;
  let webOutboxProcessed = 0;

  for (let batch = 0; batch < maxBatches; batch += 1) {
    const messageResult = messages.projectNextBatch({ batchSize });
    const outboxResult = webOutbox.projectNextBatch({ batchSize });
    messagesProcessed += messageResult.processed;
    webOutboxProcessed += outboxResult.processed;

    if (messageResult.processed === 0 && outboxResult.processed === 0) {
      break;
    }
  }

  return { messagesProcessed, webOutboxProcessed };
}

export type ProjectorLoopOptions = ProjectorOptions & {
  intervalMs?: number;
  maxBatches?: number;
  onError?: (error: unknown) => void;
};

export function startProjectorLoop(db: SqliteDatabase, options: ProjectorLoopOptions = {}): () => void {
  const intervalMs = options.intervalMs ?? 500;
  const timer = setInterval(() => {
    try {
      projectReadModelsUntilIdle(db, {
        batchSize: options.batchSize,
        maxBatches: options.maxBatches ?? 2,
      });
    } catch (error) {
      options.onError?.(error);
    }
  }, intervalMs);

  return () => clearInterval(timer);
}

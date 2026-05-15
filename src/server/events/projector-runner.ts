import type { SqliteDatabase } from "../db/migrate.js";
import { FeishuOutboxProjector, MessageProjector, QQOutboxProjector, WebOutboxProjector, type ProjectorOptions } from "./projectors.js";

export type ProjectReadModelsResult = {
  messagesProcessed: number;
  webOutboxProcessed: number;
  feishuOutboxProcessed: number;
  qqOutboxProcessed: number;
};

export function projectReadModelsUntilIdle(
  db: SqliteDatabase,
  options: ProjectorOptions & { maxBatches?: number } = {},
): ProjectReadModelsResult {
  const batchSize = options.batchSize ?? 100;
  const maxBatches = options.maxBatches ?? 20;
  const messages = new MessageProjector(db);
  const webOutbox = new WebOutboxProjector(db);
  const feishuOutbox = new FeishuOutboxProjector(db);
  const qqOutbox = new QQOutboxProjector(db);
  let messagesProcessed = 0;
  let webOutboxProcessed = 0;
  let feishuOutboxProcessed = 0;
  let qqOutboxProcessed = 0;

  for (let batch = 0; batch < maxBatches; batch += 1) {
    const messageResult = messages.projectNextBatch({ batchSize });
    const outboxResult = webOutbox.projectNextBatch({ batchSize });
    const feishuOutboxResult = feishuOutbox.projectNextBatch({ batchSize });
    const qqOutboxResult = qqOutbox.projectNextBatch({ batchSize });
    messagesProcessed += messageResult.processed;
    webOutboxProcessed += outboxResult.processed;
    feishuOutboxProcessed += feishuOutboxResult.processed;
    qqOutboxProcessed += qqOutboxResult.processed;

    if (messageResult.processed === 0 && outboxResult.processed === 0 && feishuOutboxResult.processed === 0 && qqOutboxResult.processed === 0) {
      break;
    }
  }

  return { messagesProcessed, webOutboxProcessed, feishuOutboxProcessed, qqOutboxProcessed };
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

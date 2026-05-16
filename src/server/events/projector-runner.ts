import type { SqliteDatabase } from "../db/migrate.js";
import {
  DiscordOutboxProjector,
  FeishuOutboxProjector,
  MessageProjector,
  QQOutboxProjector,
  TelegramOutboxProjector,
  WebOutboxProjector,
  type ProjectorOptions,
} from "./projectors.js";

export type ProjectReadModelsResult = {
  messagesProcessed: number;
  webOutboxProcessed: number;
  feishuOutboxProcessed: number;
  qqOutboxProcessed: number;
  telegramOutboxProcessed: number;
  discordOutboxProcessed: number;
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
  const telegramOutbox = new TelegramOutboxProjector(db);
  const discordOutbox = new DiscordOutboxProjector(db);
  let messagesProcessed = 0;
  let webOutboxProcessed = 0;
  let feishuOutboxProcessed = 0;
  let qqOutboxProcessed = 0;
  let telegramOutboxProcessed = 0;
  let discordOutboxProcessed = 0;

  for (let batch = 0; batch < maxBatches; batch += 1) {
    const m = messages.projectNextBatch({ batchSize });
    const w = webOutbox.projectNextBatch({ batchSize });
    const f = feishuOutbox.projectNextBatch({ batchSize });
    const q = qqOutbox.projectNextBatch({ batchSize });
    const t = telegramOutbox.projectNextBatch({ batchSize });
    const d = discordOutbox.projectNextBatch({ batchSize });
    messagesProcessed += m.processed;
    webOutboxProcessed += w.processed;
    feishuOutboxProcessed += f.processed;
    qqOutboxProcessed += q.processed;
    telegramOutboxProcessed += t.processed;
    discordOutboxProcessed += d.processed;

    if (m.processed === 0 && w.processed === 0 && f.processed === 0 && q.processed === 0 && t.processed === 0 && d.processed === 0) {
      break;
    }
  }

  return { messagesProcessed, webOutboxProcessed, feishuOutboxProcessed, qqOutboxProcessed, telegramOutboxProcessed, discordOutboxProcessed };
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

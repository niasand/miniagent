import type { ChannelAdapter, ChannelMessage, SendResult, TestResult } from "./types.js";

/**
 * Shared base for all channel adapters.
 * Extracts duplicated utilities and common lifecycle patterns.
 */
export abstract class BaseChannel implements ChannelAdapter {
  abstract readonly channelType: string;
  protected stopped = false;
  protected attempt = 0;

  abstract start(onMessage: (msg: ChannelMessage) => void): Promise<void>;
  abstract send(targetRef: string, content: string): Promise<SendResult>;

  stop(): void {
    this.stopped = true;
  }

  // --- Shared utilities ---

  /** Exponential backoff with a cap, resets attempt counter. */
  protected nextBackoffMs(maxMs: number): number {
    const delay = Math.min(1000 * 2 ** this.attempt, maxMs);
    this.attempt++;
    return delay;
  }

  /** Standard error wrapper for test() methods. */
  protected async safeTest(fn: () => Promise<TestResult>): Promise<TestResult> {
    try {
      return await fn();
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : "Connection failed" };
    }
  }

  /** Async sleep. */
  protected static sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Split long text into chunks by newline-aware boundaries. */
  protected static splitText(text: string, maxLen: number): string[] {
    if (text.length <= maxLen) return [text];
    const chunks: string[] = [];
    let rest = text;
    while (rest.length > 0) {
      if (rest.length <= maxLen) { chunks.push(rest); break; }
      let cut = rest.lastIndexOf("\n", maxLen);
      if (cut < maxLen * 0.5) cut = maxLen;
      chunks.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    return chunks;
  }
}

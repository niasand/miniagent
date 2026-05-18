import { afterEach, describe, expect, it, vi } from "vitest";
import { ChannelRegistry } from "../src/server/channels/registry.js";
import { WeChatChannel } from "../src/server/channels/wechat.js";
import type { ChannelAdapter, ChannelMessage, SendResult, TestResult } from "../src/server/channels/types.js";
import { createTestDb, disposeTestDb } from "./helpers.js";

describe("ChannelRegistry", () => {
  it("keeps the running adapter when candidate validation fails", async () => {
    const db = createTestDb();
    try {
      const registry = new ChannelRegistry(db, () => {});
      const current = fakeAdapter("telegram");
      const failing = fakeAdapter("telegram", { testResult: { ok: false, message: "invalid token" } });
      let candidate = current;
      mockAdapterFactory(registry, () => candidate);

      expect(await registry.startChannel("telegram", {})).toEqual({ ok: true, message: "Started" });
      candidate = failing;

      expect(await registry.startChannel("telegram", {})).toEqual({ ok: false, message: "invalid token" });
      expect(registry.get("telegram")).toBe(current);
      expect(current.stopCalls).toBe(0);
      expect(failing.startCalls).toBe(0);
    } finally {
      disposeTestDb(db);
    }
  });

  it("keeps the running adapter when candidate startup throws", async () => {
    const db = createTestDb();
    try {
      const registry = new ChannelRegistry(db, () => {});
      const current = fakeAdapter("telegram");
      const failing = fakeAdapter("telegram", { startError: new Error("websocket failed") });
      let candidate = current;
      mockAdapterFactory(registry, () => candidate);

      await registry.startChannel("telegram", {});
      candidate = failing;

      expect(await registry.startChannel("telegram", {})).toEqual({ ok: false, message: "websocket failed" });
      expect(registry.get("telegram")).toBe(current);
      expect(current.stopCalls).toBe(0);
      expect(failing.stopCalls).toBe(1);
    } finally {
      disposeTestDb(db);
    }
  });

  it("replaces the running adapter after candidate startup succeeds", async () => {
    const db = createTestDb();
    try {
      const registry = new ChannelRegistry(db, () => {});
      const current = fakeAdapter("telegram");
      const replacement = fakeAdapter("telegram");
      let candidate = current;
      mockAdapterFactory(registry, () => candidate);

      await registry.startChannel("telegram", {});
      candidate = replacement;

      expect(await registry.startChannel("telegram", {})).toEqual({ ok: true, message: "Started" });
      expect(registry.get("telegram")).toBe(replacement);
      expect(current.stopCalls).toBe(1);
      expect(replacement.startCalls).toBe(1);
    } finally {
      disposeTestDb(db);
    }
  });
});

describe("WeChatChannel", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fails test when the API returns a non-zero business code", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ ret: -14, errmsg: "expired" }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      }),
    ));

    const result = await new WeChatChannel({ bot_token: "token" }).test();

    expect(result.ok).toBe(false);
    expect(result.message).toContain("ret=-14");
    expect(result.message).toContain("expired");
  });
});

function fakeAdapter(
  channelType: string,
  options: { testResult?: TestResult; startError?: Error } = {},
): ChannelAdapter & { startCalls: number; stopCalls: number } {
  return {
    channelType,
    startCalls: 0,
    stopCalls: 0,
    async start(_onMessage: (msg: ChannelMessage) => void): Promise<void> {
      this.startCalls++;
      if (options.startError) throw options.startError;
    },
    stop(): void {
      this.stopCalls++;
    },
    async send(_targetRef: string, _content: string): Promise<SendResult> {
      return {};
    },
    async test(): Promise<TestResult> {
      return options.testResult ?? { ok: true, message: "Connected" };
    },
  };
}

function mockAdapterFactory(registry: ChannelRegistry, factory: () => ChannelAdapter): void {
  (registry as unknown as { createAdapter: () => ChannelAdapter }).createAdapter = factory;
}

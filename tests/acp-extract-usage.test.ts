import { describe, it, expect } from "vitest";
import { extractUsage } from "../src/server/runtime/acp/driver.js";
import type { JsonValue } from "../src/shared/json.js";

describe("extractUsage", () => {
  it("returns null for non-object input", () => {
    expect(extractUsage(null)).toBeNull();
    expect(extractUsage([1, 2] as unknown as JsonValue)).toBeNull();
    expect(extractUsage("str" as unknown as JsonValue)).toBeNull();
  });

  it("extracts nested usage with camelCase fields", () => {
    expect(extractUsage({ usage: { inputTokens: 100, outputTokens: 50 } })).toEqual({
      inputTokens: 100, outputTokens: 50,
      cacheReadTokens: undefined, cacheCreationTokens: undefined,
    });
  });

  it("extracts nested usage with snake_case fields", () => {
    expect(extractUsage({ usage: { input_tokens: 200, output_tokens: 80 } })).toEqual({
      inputTokens: 200, outputTokens: 80,
      cacheReadTokens: undefined, cacheCreationTokens: undefined,
    });
  });

  it("extracts cache token fields when present", () => {
    expect(extractUsage({ usage: { inputTokens: 10, cache_read_tokens: 500, cache_creation_tokens: 20 } })).toEqual({
      inputTokens: 10, outputTokens: undefined,
      cacheReadTokens: 500, cacheCreationTokens: 20,
    });
  });

  it("reads top-level fields when no nested usage object", () => {
    expect(extractUsage({ inputTokens: 7, outputTokens: 3 })).toEqual({
      inputTokens: 7, outputTokens: 3,
      cacheReadTokens: undefined, cacheCreationTokens: undefined,
    });
  });

  it("returns a result when only output is reported", () => {
    expect(extractUsage({ output_tokens: 42 })).toEqual({
      inputTokens: undefined, outputTokens: 42,
      cacheReadTokens: undefined, cacheCreationTokens: undefined,
    });
  });

  it("accepts tokenUsage / tokens aliases", () => {
    expect(extractUsage({ tokenUsage: { inputTokens: 1 } })).toMatchObject({ inputTokens: 1 });
    expect(extractUsage({ tokens: { outputTokens: 2 } })).toMatchObject({ outputTokens: 2 });
  });

  it("returns null when a usage object exists but has no token figures", () => {
    expect(extractUsage({ usage: { model: "claude" } })).toBeNull();
  });

  it("returns null when there are no usage fields at all", () => {
    expect(extractUsage({ stopReason: "end_turn", model: "claude" })).toBeNull();
  });
});

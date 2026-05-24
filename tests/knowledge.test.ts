import { describe, it, expect } from "vitest";
import { KnowledgeService } from "../src/server/services/knowledge.js";
import type { JsonValue } from "../src/shared/json.js";

const makeService = (opts?: { qmdPath?: string; wikiPath?: string }) =>
  new KnowledgeService(opts);

describe("KnowledgeService", () => {
  describe("resolveConfig", () => {
    it("disables RAG when no rag key in defaultParams", () => {
      const svc = makeService();
      const config = svc.resolveConfig({});
      expect(config.enabled).toBe(false);
    });

    it("disables RAG when rag.enabled is not true", () => {
      const svc = makeService();
      const config = svc.resolveConfig({ rag: { enabled: false } });
      expect(config.enabled).toBe(false);
    });

    it("enables RAG when rag.enabled is true", () => {
      const svc = makeService();
      const config = svc.resolveConfig({ rag: { enabled: true } });
      expect(config.enabled).toBe(true);
    });

    it("uses custom maxResults", () => {
      const svc = makeService();
      const config = svc.resolveConfig({ rag: { enabled: true, maxResults: 5 } });
      expect(config.maxResults).toBe(5);
    });

    it("uses custom wikiPath", () => {
      const svc = makeService();
      const config = svc.resolveConfig({ rag: { enabled: true, wikiPath: "/tmp/wiki" } });
      expect(config.wikiPath).toBe("/tmp/wiki");
    });

    it("falls back to defaults for missing fields", () => {
      const svc = makeService();
      const config = svc.resolveConfig({ rag: { enabled: true } });
      expect(config.maxResults).toBe(3);
      expect(config.maxSnippetChars).toBe(2000);
    });
  });

  describe("extractQueryText", () => {
    it("extracts from string input", () => {
      const svc = makeService();
      expect(svc.extractQueryText("hello world")).toBe("hello world");
    });

    it("extracts text field from object input", () => {
      const svc = makeService();
      expect(svc.extractQueryText({ text: "hello", userId: "u1" } as JsonValue)).toBe("hello");
    });

    it("returns empty string for object without text", () => {
      const svc = makeService();
      expect(svc.extractQueryText({ userId: "u1" } as JsonValue)).toBe("");
    });

    it("returns empty string for null input", () => {
      const svc = makeService();
      expect(svc.extractQueryText(null)).toBe("");
    });
  });

  describe("retrieve", () => {
    it("returns null when RAG is disabled", () => {
      const svc = makeService();
      const config = svc.resolveConfig({});
      expect(svc.retrieve("test", config)).toBeNull();
    });

    it("returns null for empty query", () => {
      const svc = makeService();
      const config = svc.resolveConfig({ rag: { enabled: true } });
      expect(svc.retrieve("", config)).toBeNull();
      expect(svc.retrieve("   ", config)).toBeNull();
    });

    it("returns null when qmd is unavailable", () => {
      const svc = makeService({ qmdPath: "/nonexistent/qmd" });
      const config = { enabled: true, wikiPath: "/tmp", maxResults: 3, maxSnippetChars: 2000 };
      expect(svc.retrieve("EventStore", config)).toBeNull();
    });

    it("returns null when qmd finds no results", () => {
      const svc = makeService({ qmdPath: "", wikiPath: "/nonexistent/path" });
      const config = { enabled: true, wikiPath: "/nonexistent/path", maxResults: 3, maxSnippetChars: 2000 };
      expect(svc.retrieve("xyzzy-no-match-12345", config)).toBeNull();
    });
  });

  describe("integration with real qmd (optional)", () => {
    it("retrieves knowledge from global wiki if qmd is available", () => {
      const svc = makeService();
      const config = svc.resolveConfig({ rag: { enabled: true } });
      const result = svc.retrieve("EventStore", config);

      if (result) {
        expect(result).toContain("[Knowledge Reference]");
        expect(result).toContain("[End of Knowledge Reference]");
        expect(result).toContain("EventStore");
      }
      // If qmd not available or no results, result is null — that's fine
    });
  });
});

describe("toPromptBlocks knowledge injection", () => {
  it("prepends knowledge block before user text", async () => {
    const { toPromptBlocks } = await import("../src/server/runtime/acp/driver.js");
    const blocks = toPromptBlocks({
      text: "user message",
      knowledge: "[Knowledge Reference] some context",
    });
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({ type: "text", text: "[Knowledge Reference] some context" });
    expect(blocks[1]).toEqual({ type: "text", text: "user message" });
  });

  it("works without knowledge field (backward compatible)", async () => {
    const { toPromptBlocks } = await import("../src/server/runtime/acp/driver.js");
    const blocks = toPromptBlocks({ text: "hello" });
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({ type: "text", text: "hello" });
  });

  it("works with plain string input", async () => {
    const { toPromptBlocks } = await import("../src/server/runtime/acp/driver.js");
    const blocks = toPromptBlocks("hello");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({ type: "text", text: "hello" });
  });
});

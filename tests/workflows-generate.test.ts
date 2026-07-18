import { describe, it, expect } from "vitest";
import { tryParseWorkflowJson } from "../src/server/workflows/generate.js";
import { validateWorkflow } from "../src/server/workflows/definition.js";

describe("tryParseWorkflowJson", () => {
  it("parses a clean JSON object", () => {
    const raw = `{"name":"t","nodes":[{"id":"a","type":"echo","message":"hi"}]}`;
    const r = tryParseWorkflowJson(raw);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.name).toBe("t");
  });

  it("extracts the JSON object even when wrapped in a markdown fence", () => {
    const raw = "```json\n{\"name\":\"t\",\"nodes\":[]}\n```\n解释文字";
    const r = tryParseWorkflowJson(raw);
    expect(r.ok).toBe(true);
  });

  it("extracts JSON when claude adds prose around it", () => {
    const raw = `好的，这是配置：\n{"name":"demo","nodes":[{"id":"a","type":"echo","message":"x"}]}\n如上。`;
    expect(tryParseWorkflowJson(raw).ok).toBe(true);
  });

  it("fails when no JSON object is present", () => {
    expect(tryParseWorkflowJson("没有 JSON").ok).toBe(false);
  });

  it("fails on malformed JSON", () => {
    expect(tryParseWorkflowJson(`{"name":"t","nodes":[}`).ok).toBe(false);
  });

  it("fails when name is missing", () => {
    expect(tryParseWorkflowJson(`{"nodes":[]}`).ok).toBe(false);
  });

  it("fails when nodes is missing or not an array", () => {
    expect(tryParseWorkflowJson(`{"name":"t"}`).ok).toBe(false);
    expect(tryParseWorkflowJson(`{"name":"t","nodes":"x"}`).ok).toBe(false);
  });
});

describe("generate → validate pipeline (parse then validate)", () => {
  it("a well-formed generated definition passes validateWorkflow", () => {
    const raw = `{"name":"demo","nodes":[{"id":"a","type":"echo","message":"hi"},{"id":"g","type":"human_gate","prompt":"ok?","dependsOn":["a"]},{"id":"b","type":"echo","message":"done","dependsOn":["g"]}]}`;
    const parsed = tryParseWorkflowJson(raw);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(validateWorkflow(parsed.value).ok).toBe(true);
  });

  it("a definition with an unknown dependency is parsed but fails validation", () => {
    const raw = `{"name":"bad","nodes":[{"id":"a","type":"echo","message":"hi","dependsOn":["ghost"]}]}`;
    const parsed = tryParseWorkflowJson(raw);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(validateWorkflow(parsed.value).ok).toBe(false);
  });
});

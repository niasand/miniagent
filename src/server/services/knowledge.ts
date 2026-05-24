import { spawnSync } from "node:child_process";
import type { JsonObject, JsonValue } from "../../shared/json.js";

export type KnowledgeConfig = {
  enabled: boolean;
  wikiPath: string;
  maxResults: number;
  maxSnippetChars: number;
};

type QmdSearchResult = {
  path: string;
  title: string;
  score: number;
  snippet: string;
};

const DEFAULT_WIKI_PATH = "/Users/zhiwei/wiki_workspace/wiki";

export class KnowledgeService {
  private readonly qmdPath: string;
  private readonly defaultConfig: Omit<KnowledgeConfig, "enabled">;

  constructor(options?: { qmdPath?: string; wikiPath?: string }) {
    this.qmdPath = options?.qmdPath ?? resolveQmdPath();
    this.defaultConfig = {
      wikiPath: options?.wikiPath ?? DEFAULT_WIKI_PATH,
      maxResults: 3,
      maxSnippetChars: 2000,
    };
  }

  resolveConfig(sessionDefaultParams: JsonValue): KnowledgeConfig {
    const params = asJsonObject(sessionDefaultParams);
    const rag = asJsonObject(params.rag);
    if (!rag || rag.enabled !== true) {
      return { ...this.defaultConfig, enabled: false };
    }
    return {
      enabled: true,
      wikiPath: typeof rag.wikiPath === "string" ? rag.wikiPath : this.defaultConfig.wikiPath,
      maxResults: typeof rag.maxResults === "number" ? rag.maxResults : this.defaultConfig.maxResults,
      maxSnippetChars: typeof rag.maxSnippetChars === "number" ? rag.maxSnippetChars : this.defaultConfig.maxSnippetChars,
    };
  }

  extractQueryText(taskInput: JsonValue): string {
    if (typeof taskInput === "string") return taskInput;
    const obj = asJsonObject(taskInput);
    return typeof obj.text === "string" ? obj.text : "";
  }

  retrieve(queryText: string, config: KnowledgeConfig): string | null {
    if (!config.enabled || !queryText.trim()) return null;
    if (!this.qmdPath) return null;

    const start = Date.now();
    try {
      const results = this.queryQmd(queryText, config);
      if (results.length === 0) return null;

      const block = this.formatKnowledgeBlock(results, config);
      const elapsed = Date.now() - start;
      console.log(`[Knowledge] Retrieved ${results.length} results in ${elapsed}ms (${block.length} chars)`);
      return block;
    } catch (error) {
      console.warn("[Knowledge] Retrieval failed:", error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  private queryQmd(query: string, config: KnowledgeConfig): QmdSearchResult[] {
    const result = spawnSync(this.qmdPath, [
      "search", query,
      "-n", String(config.maxResults),
    ], {
      cwd: config.wikiPath,
      encoding: "utf8",
      timeout: 400,
    });

    if (result.error || result.status !== 0 || !result.stdout) return [];
    return parseQmdOutput(result.stdout);
  }

  private formatKnowledgeBlock(results: QmdSearchResult[], config: KnowledgeConfig): string {
    const parts: string[] = ["[Knowledge Reference] Retrieved from project knowledge base:\n"];
    let remaining = config.maxSnippetChars;

    for (const r of results) {
      if (remaining <= 0) break;
      const entry = `\n---\nSource: ${r.path}\n${r.snippet}\n`;
      if (entry.length > remaining) {
        parts.push(entry.slice(0, remaining - 4) + "...\n");
      } else {
        parts.push(entry);
      }
      remaining -= entry.length;
    }

    parts.push("---\n[End of Knowledge Reference]");
    return parts.join("\n");
  }
}

function parseQmdOutput(output: string): QmdSearchResult[] {
  const results: QmdSearchResult[] = [];
  const entries = output.split(/(?=qmd:\/\/)/);

  for (const entry of entries) {
    const pathMatch = entry.match(/^qmd:\/\/(.+?):\d+/);
    const titleMatch = entry.match(/^Title:\s*(.+)$/m);
    const scoreMatch = entry.match(/^Score:\s*(\d+)%/m);

    const snippetLines: string[] = [];
    let inSnippet = false;
    for (const line of entry.split("\n")) {
      if (line.startsWith("@@ ")) {
        inSnippet = true;
        continue;
      }
      if (inSnippet && line.trim()) {
        snippetLines.push(line);
      }
    }

    if (pathMatch) {
      results.push({
        path: pathMatch[1],
        title: titleMatch?.[1] ?? "",
        score: scoreMatch ? parseInt(scoreMatch[1], 10) : 0,
        snippet: snippetLines.join("\n").trim(),
      });
    }
  }

  return results;
}

function resolveQmdPath(): string {
  try {
    const result = spawnSync("which", ["qmd"], { encoding: "utf8", timeout: 2000 });
    if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();
  } catch { /* not found */ }
  return "";
}

function asJsonObject(value: JsonValue): JsonObject {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  return {};
}

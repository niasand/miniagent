import { readdir, readFile, stat } from "node:fs/promises";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export type SkillMeta = {
  name: string;
  description: string;
  source: string;
  path: string;
};

export type SkillDetail = SkillMeta & {
  content: string;
};

export class SkillService {
  private readonly dirs = [
    { source: "project", path: join(process.cwd(), ".claude", "skills") },
    { source: "user", path: join(homedir(), ".claude", "skills") },
  ];

  async list(): Promise<SkillMeta[]> {
    const seen = new Set<string>();
    const results: SkillMeta[] = [];
    for (const dir of this.dirs) {
      let entries: string[];
      try {
        entries = await readdir(dir.path);
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (seen.has(entry)) continue;
        const entryPath = join(dir.path, entry);
        const s = await stat(entryPath).catch(() => null);
        if (!s?.isDirectory()) continue;
        seen.add(entry);
        const content = await readSkillFile(entryPath);
        results.push({
          name: entry,
          description: parseFrontmatterDescription(content) ?? "",
          source: dir.source,
          path: entryPath,
        });
      }
    }
    return results;
  }

  listSync(): SkillMeta[] {
    const seen = new Set<string>();
    const results: SkillMeta[] = [];
    for (const dir of this.dirs) {
      let entries: string[];
      try {
        entries = readdirSync(dir.path);
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (seen.has(entry)) continue;
        const entryPath = join(dir.path, entry);
        try {
          if (!statSync(entryPath).isDirectory()) continue;
        } catch {
          continue;
        }
        seen.add(entry);
        const content = readSkillFileSync(entryPath);
        results.push({
          name: entry,
          description: parseFrontmatterDescription(content) ?? "",
          source: dir.source,
          path: entryPath,
        });
      }
    }
    return results;
  }

  async get(name: string): Promise<SkillDetail | null> {
    const cleanName = name.trim();
    if (!cleanName || cleanName.includes("/") || cleanName.includes("\\")) return null;
    for (const dir of this.dirs) {
      const entryPath = resolve(dir.path, cleanName);
      if (!entryPath.startsWith(resolve(dir.path))) continue;
      const s = await stat(entryPath).catch(() => null);
      if (!s?.isDirectory()) continue;
      const content = await readSkillFile(entryPath);
      return {
        name: cleanName,
        description: parseFrontmatterDescription(content) ?? "",
        source: dir.source,
        path: entryPath,
        content,
      };
    }
    return null;
  }
}

async function readSkillFile(entryPath: string): Promise<string> {
  for (const file of ["SKILL.md", "skill.md", "README.md"]) {
    const content = await readFile(join(entryPath, file), "utf-8").catch(() => "");
    if (content) return content;
  }
  return "";
}

function readSkillFileSync(entryPath: string): string {
  for (const file of ["SKILL.md", "skill.md", "README.md"]) {
    try {
      const content = readFileSync(join(entryPath, file), "utf-8");
      if (content) return content;
    } catch {
      continue;
    }
  }
  return "";
}

export function parseFrontmatterDescription(markdown: string): string | null {
  const match = markdown.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const frontmatter = match[1];
  const multilineMatch = frontmatter.match(
    /^description:\s*(?:[>|][+-]?)\s*\n([\s\S]*?)(?=\n\w|\n---|$)/m,
  );
  if (multilineMatch) return multilineMatch[1].replace(/^\s+/, "").trim();
  const simpleMatch = frontmatter.match(/^description:\s*(.+)/m);
  return simpleMatch?.[1]?.replace(/^["']|["']$/g, "").trim() ?? null;
}

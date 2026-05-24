export type AgentType = "codex" | "claude" | "trae";

export type ChatMessage = {
  id: string;
  role: "user" | "agent" | "tool" | "system";
  author: string;
  time?: string;
  createdAt?: string;
  badge?: string;
  markdown: string;
};

export type RunStats = {
  durationSeconds: number | null;
  tokensUsed: number | null;
  tokensTotal: number | null;
};

export type SkillMeta = {
  name: string;
  description: string;
  source: "project" | "user";
  path: string;
};

export type ListSkillsResponse = {
  skills: SkillMeta[];
};

export type AgentType = "codex" | "claude" | "trae";

export type ChatMessage = {
  id: string;
  role: "user" | "agent" | "tool" | "system";
  author: string;
  time?: string;
  badge?: string;
  markdown: string;
};

export type SkillMeta = {
  name: string;
  description: string;
  source: "project" | "user";
};

export type ListSkillsResponse = {
  skills: SkillMeta[];
};

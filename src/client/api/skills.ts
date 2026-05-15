import type { ListSkillsResponse } from "./types.js";

export async function fetchSkills(): Promise<ListSkillsResponse> {
  const response = await fetch("/api/skills", {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Skills API failed: ${response.status}`);
  return (await response.json()) as ListSkillsResponse;
}

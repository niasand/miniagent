import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { fetchSkills } from "../api/skills.js";
import type { SkillMeta } from "../api/types.js";
import type { AppSection } from "./use-navigation.js";

export function useSkills(activeSection: AppSection) {
  const [selectedSkillName, setSelectedSkillName] = useState<string | null>(null);
  const [skillsQuery, setSkillsQuery] = useState("");
  const skillsSearchRef = useRef<HTMLInputElement>(null);

  const { data: skillsData } = useQuery({
    queryKey: ["skills"],
    queryFn: fetchSkills,
    refetchInterval: 30_000,
  });
  const skills: SkillMeta[] = skillsData?.skills ?? [];

  const filteredSkills = skillsQuery
    ? skills.filter(
        (skill) =>
          skill.name.toLowerCase().includes(skillsQuery.toLowerCase()) ||
          skill.description.toLowerCase().includes(skillsQuery.toLowerCase()),
      )
    : skills;

  const selectedSkill = selectedSkillName
    ? skills.find((skill) => skill.name === selectedSkillName) ?? filteredSkills[0] ?? skills[0] ?? null
    : filteredSkills[0] ?? skills[0] ?? null;

  const handleSkillSelect = (skill: SkillMeta) => {
    setSelectedSkillName(skill.name);
  };

  // Focus search input when skills section is activated
  useEffect(() => {
    if (activeSection === "skills") {
      requestAnimationFrame(() => skillsSearchRef.current?.focus());
    }
  }, [activeSection]);

  return {
    skillsQuery,
    setSkillsQuery,
    skillsSearchRef,
    filteredSkills,
    selectedSkill,
    handleSkillSelect,
  } as const;
}

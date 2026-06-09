import { Search } from "lucide-react";
import type { SkillMeta } from "../../api/types.js";

interface SkillListProps {
  skillsQuery: string;
  setSkillsQuery: (value: string) => void;
  skillsSearchRef: React.RefObject<HTMLInputElement | null>;
  filteredSkills: SkillMeta[];
  selectedSkill: SkillMeta | null;
  handleSkillSelect: (skill: SkillMeta) => void;
}

export function SkillList({
  skillsQuery,
  setSkillsQuery,
  skillsSearchRef,
  filteredSkills,
  selectedSkill,
  handleSkillSelect,
}: SkillListProps) {
  return (
    <>
      <div className="side-header">
        <span className="side-eyebrow">技能</span>
        <h2>技能列表</h2>
      </div>
      <div className="side-search">
        <Search className="h-4 w-4 side-search-icon" />
        <input
          ref={skillsSearchRef}
          className="side-search-input"
          value={skillsQuery}
          onChange={(event) => setSkillsQuery(event.currentTarget.value)}
          placeholder="搜索技能..."
        />
      </div>
      <div className="context-list">
        {filteredSkills.length === 0 && <div className="side-empty">没有匹配的技能</div>}
        {filteredSkills.map((skill) => (
          <button
            key={skill.name}
            className={`context-item ${selectedSkill?.name === skill.name ? "context-item--active" : ""}`}
            onClick={() => handleSkillSelect(skill)}
          >
            <strong>{skill.name}</strong>
            {skill.description && <span>{skill.description}</span>}
          </button>
        ))}
      </div>
    </>
  );
}

import { Sparkles } from "lucide-react";
import type { SkillMeta } from "../../api/types.js";
import { CopyButton } from "../ui/copy-button.js";
import { Button } from "../ui/button.js";

interface SkillDetailProps {
  selectedSkill: SkillMeta | null;
  useSkillInWorkspace: (skill: SkillMeta) => void;
}

export function SkillDetail({ selectedSkill, useSkillInWorkspace }: SkillDetailProps) {
  return (
    <div className="detail-scroll">
      {selectedSkill ? (
        <>
          <div className="detail-header">
            <div>
              <span className="side-eyebrow">技能详情</span>
              <h1>{selectedSkill.name}</h1>
            </div>
            <Button variant="primary" onClick={() => useSkillInWorkspace(selectedSkill!)}>
              <Sparkles className="h-4 w-4" />
              使用技能
            </Button>
          </div>
          <div className="detail-section">
            <h2>说明</h2>
            <p>{selectedSkill.description || "暂无说明。"}</p>
          </div>
          <div className="detail-section">
            <h2>调用方式</h2>
            <code className="inline-code">/{selectedSkill.name}</code>
          </div>
          <div className="detail-section">
            <h2>路径</h2>
            <div className="skill-path-row">
              <code className="inline-code skill-path-code">{selectedSkill.path}</code>
              <CopyButton text={selectedSkill!.path} label="路径" className="copy-path-btn" size="md" />
            </div>
          </div>
        </>
      ) : (
        <div className="detail-empty">尚未选择技能</div>
      )}
    </div>
  );
}

import type { AgentType } from "../../api/types.js";

type SettingsSection = "channels" | "provider";

interface SettingsListProps {
  settingsSection: SettingsSection;
  setSettingsSection: (section: SettingsSection) => void;
  agentType: AgentType;
}

export function SettingsList({
  settingsSection,
  setSettingsSection,
  agentType,
}: SettingsListProps) {
  return (
    <>
      <div className="side-header">
        <span className="side-eyebrow">设置</span>
        <h2>设置项</h2>
      </div>
      <div className="context-list">
        <button className={`context-item ${settingsSection === "channels" ? "context-item--active" : ""}`} onClick={() => setSettingsSection("channels")}>
          <strong>消息通道</strong>
          <span>Feishu, QQ, Telegram, WeChat</span>
        </button>
        <button className={`context-item ${settingsSection === "provider" ? "context-item--active" : ""}`} onClick={() => setSettingsSection("provider")}>
          <strong>提供方</strong>
          <span>默认 {agentType}</span>
        </button>
      </div>
    </>
  );
}

import type { AgentType } from "../../api/types.js";
import type { ChannelInfo } from "../../api/channels.js";
import type { WorkspaceAgentRuntime } from "../../../shared/workspace.js";
import { ChannelCard } from "../channel-card.js";
import { Badge } from "../ui/badge.js";
import { ProviderSelect } from "../controls.js";
import { localizeProviderErrorMessage } from "../../lib/error-messages.js";
import { formatCapabilityAvailability, formatCapabilityName, formatProviderStatus } from "../../lib/status-labels.js";

/** Map provider status to Badge tone */
function providerStatusTone(status: string): "success" | "warning" | "error" | "violet" | "muted" {
  if (status === "healthy") return "success";
  if (status === "missing") return "warning";
  if (status === "failed") return "error";
  if (status === "auth_required") return "violet";
  return "muted";
}

type SettingsSection = "channels" | "provider";

interface SettingsDetailProps {
  settingsSection: SettingsSection;
  channels: ChannelInfo[];
  onChannelsSaved: () => void;
  agentType: AgentType;
  setAgentType: (value: AgentType) => void;
  providerRuntimes: WorkspaceAgentRuntime[];
  providerSavePending: boolean;
  providerError: string | null;
}

export function SettingsDetail({
  settingsSection,
  channels,
  onChannelsSaved,
  agentType,
  setAgentType,
  providerRuntimes,
  providerSavePending,
  providerError,
}: SettingsDetailProps) {
  return (
    <div className="detail-scroll">
      <div className="detail-header">
        <div>
          <span className="side-eyebrow">设置</span>
          <h1>{settingsSection === "channels" ? "消息通道详情" : "提供方详情"}</h1>
        </div>
      </div>
      {settingsSection === "channels" ? (
        <div className="settings-channel-grid">
          {channels.length === 0 && <div className="detail-empty">暂无可用通道</div>}
          {channels.map((channel) => (
            <ChannelCard key={channel.id} channel={channel} onSaved={onChannelsSaved} />
          ))}
        </div>
      ) : (
        <div className="detail-section">
          <h2>默认提供方</h2>
          <ProviderSelect
            value={agentType}
            onChange={setAgentType}
            agents={providerRuntimes}
            saving={providerSavePending}
          />
          {providerError && <p className="provider-error" role="alert">{providerError}</p>}
        </div>
      )}
      {settingsSection === "provider" && (
        <div className="detail-section">
          <h2>提供方能力</h2>
          <div className="provider-capability-grid">
            {providerRuntimes.map((runtime) => (
              <div key={runtime.agentType} className={`provider-capability-card ${runtime.agentType === agentType ? "provider-capability-card--active" : ""}`}>
                <div className="provider-capability-header">
                  <div>
                    <strong>{runtime.label}</strong>
                    <p>{runtime.command}</p>
                  </div>
                  <Badge tone={providerStatusTone(runtime.status)}>{formatProviderStatus(runtime.status)}</Badge>
                </div>
                {runtime.message && <p className="provider-capability-message">{localizeProviderErrorMessage(runtime.message)}</p>}
                <div className="provider-capability-list">
                  {Object.entries(runtime.capabilities).map(([name, enabled]) => (
                    <Badge key={name} tone={enabled ? "success" : "muted"} shape="pill" className="text-[10px]">
                      {formatCapabilityName(name)}：{formatCapabilityAvailability(enabled)}
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

import { useState } from "react";
import type { AgentType } from "../../api/types.js";
import type { ChannelInfo } from "../../api/channels.js";
import type { NotificationPreference, WorkspaceAgentRuntime, WorkspaceScheduleNotificationTarget } from "../../../shared/workspace.js";
import { ChannelCard } from "../channel-card.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
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
  notificationPreference: NotificationPreference | null;
  latestPrivateNotificationTargets: WorkspaceScheduleNotificationTarget[];
  notificationPreferenceLoading: boolean;
  bindNotificationPreference: () => Promise<void>;
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
  notificationPreference,
  latestPrivateNotificationTargets,
  notificationPreferenceLoading,
  bindNotificationPreference,
  agentType,
  setAgentType,
  providerRuntimes,
  providerSavePending,
  providerError,
}: SettingsDetailProps) {
  const [bindingNotificationPreference, setBindingNotificationPreference] = useState(false);
  const [notificationPreferenceError, setNotificationPreferenceError] = useState<string | null>(null);

  const boundTargets = notificationPreference?.targets ?? [];
  const effectiveTargets = boundTargets.length ? boundTargets : latestPrivateNotificationTargets;
  const notificationState = boundTargets.length ? "已绑定" : effectiveTargets.length ? "自动匹配" : "未发现私聊";

  const handleBindNotificationPreference = async () => {
    if (bindingNotificationPreference) return;
    setBindingNotificationPreference(true);
    setNotificationPreferenceError(null);
    try {
      await bindNotificationPreference();
    } catch (error) {
      setNotificationPreferenceError(error instanceof Error ? error.message : "绑定默认通知失败");
    } finally {
      setBindingNotificationPreference(false);
    }
  };

  return (
    <div className="detail-scroll">
      <div className="detail-header">
        <div>
          <span className="side-eyebrow">设置</span>
          <h1>{settingsSection === "channels" ? "消息通道详情" : "提供方详情"}</h1>
        </div>
      </div>
      {settingsSection === "channels" ? (
        <>
          <div className="detail-section notification-defaults">
            <div className="notification-defaults-header">
              <div>
                <h2>默认通知私聊</h2>
                <p>定时任务默认发送到你的 QQ/Telegram 私聊。</p>
              </div>
              <Badge tone={boundTargets.length ? "success" : effectiveTargets.length ? "info" : "warning"}>{notificationState}</Badge>
            </div>
            <div className="notification-target-grid">
              <NotificationTargetPanel title="当前目标" targets={effectiveTargets} emptyText={notificationPreferenceLoading ? "加载中" : "暂无私聊目标"} />
              <NotificationTargetPanel title="最近私聊" targets={latestPrivateNotificationTargets} emptyText="暂无可绑定私聊" />
            </div>
            {notificationPreferenceError && <p className="provider-error" role="alert">{notificationPreferenceError}</p>}
            <div className="notification-defaults-actions">
              <Button
                variant="default"
                onClick={handleBindNotificationPreference}
                disabled={bindingNotificationPreference || notificationPreferenceLoading || latestPrivateNotificationTargets.length === 0}
              >
                {bindingNotificationPreference ? "绑定中" : "绑定最近私聊"}
              </Button>
            </div>
          </div>
          <div className="settings-channel-grid">
            {channels.length === 0 && <div className="detail-empty">暂无可用通道</div>}
            {channels.map((channel) => (
              <ChannelCard key={channel.id} channel={channel} onSaved={onChannelsSaved} />
            ))}
          </div>
        </>
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

function NotificationTargetPanel({
  title,
  targets,
  emptyText,
}: {
  title: string;
  targets: WorkspaceScheduleNotificationTarget[];
  emptyText: string;
}) {
  return (
    <div className="notification-target-panel">
      <strong>{title}</strong>
      {targets.length === 0 ? (
        <span>{emptyText}</span>
      ) : (
        targets.map((target) => (
          <span key={`${target.channelType}:${target.targetRef}`} title={target.targetRef}>
            {formatNotificationChannel(target.channelType)} · {target.targetRef}
          </span>
        ))
      )}
    </div>
  );
}

function formatNotificationChannel(channelType: WorkspaceScheduleNotificationTarget["channelType"]) {
  return channelType === "qq" ? "QQ" : "Telegram";
}

import { Check, ChevronDown, Globe2 } from "lucide-react";
import { useState } from "react";
import type { AgentType } from "../api/types.js";
import type { WorkspaceAgentRuntime } from "../../shared/workspace.js";

export const AGENT_OPTIONS: Array<{ value: AgentType; label: string }> = [
  { value: "codex", label: "Codex" },
  { value: "claude", label: "Claude" },
  { value: "trae", label: "Trae" },
];

type ProviderOption = {
  value: AgentType;
  label: string;
  disabled: boolean;
  reason?: string;
  status: WorkspaceAgentRuntime["status"] | "unknown";
};

export const SCHEDULE_TIMEZONES = [
  "Asia/Shanghai",
  "UTC",
  "America/Los_Angeles",
  "America/New_York",
  "Europe/London",
];

export function TimezoneSelect({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  const [open, setOpen] = useState(false);

  const closeWhenFocusLeaves = (event: React.FocusEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget;
    if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
      setOpen(false);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className="timezone-select" onBlur={closeWhenFocusLeaves} onKeyDown={handleKeyDown}>
      <button
        type="button"
        className={`timezone-trigger ${open ? "timezone-trigger--open" : ""}`}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Globe2 className="h-4 w-4 timezone-trigger-icon" />
        <span className="timezone-trigger-text">
          <span className="timezone-name">{value}</span>
          <span className="timezone-detail">{formatTimezoneDetail(value)}</span>
        </span>
        <ChevronDown className="h-3.5 w-3.5 timezone-chevron" />
      </button>
      {open && (
        <div className="timezone-menu" role="listbox" aria-label={label}>
          {SCHEDULE_TIMEZONES.map((timezone) => {
            const selected = timezone === value;
            return (
              <button
                key={timezone}
                type="button"
                role="option"
                aria-selected={selected}
                className={`timezone-option ${selected ? "timezone-option--selected" : ""}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange(timezone);
                  setOpen(false);
                }}
              >
                <span className="timezone-option-text">
                  <span className="timezone-name">{timezone}</span>
                  <span className="timezone-detail">{formatTimezoneDetail(timezone)}</span>
                </span>
                {selected && <Check className="h-3.5 w-3.5" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function ProviderSelect({
  value,
  onChange,
  agents,
  saving,
}: {
  value: AgentType;
  onChange: (value: AgentType) => void;
  agents: WorkspaceAgentRuntime[];
  saving?: boolean;
}) {
  const options: ProviderOption[] = AGENT_OPTIONS.map((option) => {
    const runtime = agents.find((agent) => agent.agentType === option.value);
    const disabled = runtime ? runtime.status !== "healthy" : true;
    return {
      value: option.value,
      label: option.label,
      disabled,
      reason: disabled ? getProviderDisabledReason(runtime) : undefined,
      status: runtime?.status ?? "unknown",
    };
  });

  return (
    <div className="provider-select" role="radiogroup" aria-label="Provider">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <div key={option.value} className="provider-toggle-wrap">
            <button
              type="button"
              role="radio"
              aria-checked={selected}
              aria-disabled={option.disabled ? "true" : "false"}
              className={`provider-toggle ${selected ? "provider-toggle--selected" : ""} ${option.disabled ? "provider-toggle--disabled" : ""}`}
              onClick={() => {
                if (!option.disabled && !saving) onChange(option.value);
              }}
              disabled={option.disabled || saving}
              title={option.reason}
            >
              <span className="provider-toggle-text">
                <strong>{option.label}</strong>
                <small>{option.value}</small>
              </span>
              <span className={`provider-toggle-status provider-toggle-status--${option.status}`}>{formatProviderStatus(option.status)}</span>
              {selected && <Check className="h-3.5 w-3.5" />}
            </button>
            {option.reason && <p className="provider-toggle-reason">{option.reason}</p>}
          </div>
        );
      })}
    </div>
  );
}

function getProviderDisabledReason(runtime?: WorkspaceAgentRuntime): string {
  if (!runtime) return "Provider probe is unavailable";
  if (runtime.message) return runtime.message;
  if (runtime.status === "missing") return `${runtime.label} is not installed on this machine`;
  if (runtime.status === "auth_required") return `${runtime.label} requires authentication`;
  if (runtime.status === "failed") return `${runtime.label} is not available right now`;
  return `${runtime.label} cannot be selected right now`;
}

export function formatProviderStatus(status: ProviderOption["status"]): string {
  if (status === "healthy") return "已就绪";
  if (status === "missing") return "未安装";
  if (status === "auth_required") return "需认证";
  if (status === "failed") return "异常";
  return "未知";
}

function formatTimezoneDetail(timezone: string): string {
  const now = new Date();
  try {
    const parts = new Intl.DateTimeFormat(undefined, {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZoneName: "shortOffset",
    }).formatToParts(now);
    const time = `${parts.find((part) => part.type === "hour")?.value ?? ""}:${parts.find((part) => part.type === "minute")?.value ?? ""}`;
    const offset = parts.find((part) => part.type === "timeZoneName")?.value.replace("GMT", "UTC") ?? "";
    return `${time} ${offset}`.trim();
  } catch {
    return timezone;
  }
}

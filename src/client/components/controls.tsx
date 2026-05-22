import { Check, ChevronDown, Globe2 } from "lucide-react";
import { useState } from "react";
import type { AgentType } from "../api/types.js";

export const AGENT_OPTIONS: Array<{ value: AgentType; label: string }> = [
  { value: "codex", label: "Codex" },
  { value: "claude", label: "Claude" },
  { value: "trae", label: "Trae" },
];

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

export function ProviderSelect({ value, onChange }: { value: AgentType; onChange: (value: AgentType) => void }) {
  return (
    <div className="provider-select" role="radiogroup" aria-label="Provider">
      {AGENT_OPTIONS.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            className={`provider-toggle ${selected ? "provider-toggle--selected" : ""}`}
            onClick={() => onChange(option.value)}
          >
            <span className="provider-toggle-text">
              <strong>{option.label}</strong>
              <small>{option.value}</small>
            </span>
            {selected && <Check className="h-3.5 w-3.5" />}
          </button>
        );
      })}
    </div>
  );
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

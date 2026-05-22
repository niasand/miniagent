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
  const [open, setOpen] = useState(false);
  const selected = AGENT_OPTIONS.find((option) => option.value === value) ?? AGENT_OPTIONS[0];

  const closeWhenFocusLeaves = (event: React.FocusEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget;
    if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
      setOpen(false);
    }
  };

  return (
    <div className="provider-select" onBlur={closeWhenFocusLeaves}>
      <button
        type="button"
        className={`provider-trigger ${open ? "provider-trigger--open" : ""}`}
        aria-label="Provider"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span>
          <strong>{selected.label}</strong>
          <small>{selected.value}</small>
        </span>
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div className="provider-menu" role="listbox" aria-label="Provider">
          {AGENT_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              className={`provider-option ${option.value === value ? "provider-option--selected" : ""}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              <span>{option.label}</span>
              {option.value === value && <Check className="h-3.5 w-3.5" />}
            </button>
          ))}
        </div>
      )}
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

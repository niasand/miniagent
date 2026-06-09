import { useEffect, useState } from "react";

export type AppSection = "workspace" | "skills" | "tasks" | "settings";
export type SettingsSection = "channels" | "provider";

function getNavigationStateFromHash(): { activeSection: AppSection; settingsSection: SettingsSection } {
  if (typeof window === "undefined") {
    return { activeSection: "workspace", settingsSection: "channels" };
  }

  const rawHash = window.location.hash.replace(/^#/, "");
  if (rawHash === "skills") return { activeSection: "skills", settingsSection: "channels" };
  if (rawHash === "tasks") return { activeSection: "tasks", settingsSection: "channels" };
  if (rawHash.startsWith("settings")) {
    const detail = rawHash.split("/")[1];
    return {
      activeSection: "settings",
      settingsSection: detail === "provider" ? "provider" : "channels",
    };
  }
  return { activeSection: "workspace", settingsSection: "channels" };
}

function buildNavigationHash(activeSection: AppSection, settingsSection: SettingsSection): string {
  if (activeSection === "settings") return `#settings/${settingsSection}`;
  return `#${activeSection}`;
}

export function useNavigation() {
  const [activeSection, setActiveSection] = useState<AppSection>(() => getNavigationStateFromHash().activeSection);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>(() => getNavigationStateFromHash().settingsSection);

  // Sync hash -> state when user navigates via browser
  useEffect(() => {
    const syncFromHash = () => {
      const nextState = getNavigationStateFromHash();
      setActiveSection(nextState.activeSection);
      setSettingsSection(nextState.settingsSection);
    };
    window.addEventListener("hashchange", syncFromHash);
    return () => window.removeEventListener("hashchange", syncFromHash);
  }, []);

  // Sync state -> hash when section changes internally
  useEffect(() => {
    const nextHash = buildNavigationHash(activeSection, settingsSection);
    if (window.location.hash !== nextHash) {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${nextHash}`);
    }
  }, [activeSection, settingsSection]);

  return { activeSection, setActiveSection, settingsSection, setSettingsSection } as const;
}

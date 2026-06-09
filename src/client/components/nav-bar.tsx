import { CalendarClock, Clock, Settings, Sparkles } from "lucide-react";

type AppSection = "workspace" | "skills" | "tasks" | "settings";

interface NavBarProps {
  activeSection: AppSection;
  setActiveSection: (section: AppSection) => void;
}

export function NavBar({ activeSection, setActiveSection }: NavBarProps) {
  return (
    <nav className="app-nav" aria-label="Primary">
      <div className="app-brand">MiniAgent</div>
      <button className={`nav-item ${activeSection === "workspace" ? "active" : ""}`} onClick={() => setActiveSection("workspace")}>
        <Clock className="h-4 w-4" />
        <span>工作台</span>
      </button>
      <button className={`nav-item ${activeSection === "skills" ? "active" : ""}`} onClick={() => setActiveSection("skills")}>
        <Sparkles className="h-4 w-4" />
        <span>技能</span>
      </button>
      <button className={`nav-item ${activeSection === "tasks" ? "active" : ""}`} onClick={() => setActiveSection("tasks")}>
        <CalendarClock className="h-4 w-4" />
        <span>任务</span>
      </button>
      <button className={`nav-item ${activeSection === "settings" ? "active" : ""}`} onClick={() => setActiveSection("settings")}>
        <Settings className="h-4 w-4" />
        <span>设置</span>
      </button>
    </nav>
  );
}

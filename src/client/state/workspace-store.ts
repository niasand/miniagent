import { create } from "zustand";
import type { WorkspaceAgentType } from "../../shared/workspace.js";

type WorkspaceState = {
  selectedSessionId: string;
  defaultAgentType: WorkspaceAgentType;
  commandOpen: boolean;
  setSelectedSessionId: (id: string) => void;
  setDefaultAgentType: (agentType: WorkspaceAgentType) => void;
  setCommandOpen: (open: boolean) => void;
};

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  selectedSessionId: "session-prd",
  defaultAgentType: "codex",
  commandOpen: false,
  setSelectedSessionId: (id) => set({ selectedSessionId: id }),
  setDefaultAgentType: (agentType) => set({ defaultAgentType: agentType }),
  setCommandOpen: (open) => set({ commandOpen: open }),
}));

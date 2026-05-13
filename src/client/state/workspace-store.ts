import { create } from "zustand";

type WorkspaceState = {
  selectedSessionId: string;
  commandOpen: boolean;
  setSelectedSessionId: (id: string) => void;
  setCommandOpen: (open: boolean) => void;
};

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  selectedSessionId: "session-prd",
  commandOpen: false,
  setSelectedSessionId: (id) => set({ selectedSessionId: id }),
  setCommandOpen: (open) => set({ commandOpen: open }),
}));

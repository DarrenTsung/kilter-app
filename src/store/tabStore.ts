import { create } from "zustand";

export type Tab = "randomizer" | "logbook" | "search" | "profile" | "settings";

export interface ForkData {
  sourceUuid: string;
  sourceName: string;
  frames: string;
}

interface TabState {
  activeTab: Tab;
  setTab: (tab: Tab) => void;
  logbookFilterClimb: string | null;
  setLogbookFilterClimb: (uuid: string | null) => void;
  pendingFork: ForkData | null;
  setPendingFork: (fork: ForkData | null) => void;
}

export const useTabStore = create<TabState>()((set) => ({
  activeTab: "randomizer",
  setTab: (tab) => set({ activeTab: tab }),
  logbookFilterClimb: null,
  setLogbookFilterClimb: (uuid) => set({ logbookFilterClimb: uuid }),
  pendingFork: null,
  setPendingFork: (pendingFork) => set({ pendingFork }),
}));

import { create } from "zustand";

export type Tab = "randomizer" | "logbook" | "search" | "create" | "settings";

interface TabState {
  activeTab: Tab;
  setTab: (tab: Tab) => void;
  logbookFilterClimb: string | null;
  setLogbookFilterClimb: (uuid: string | null) => void;
}

export const useTabStore = create<TabState>()((set) => ({
  activeTab: "randomizer",
  setTab: (tab) => set({ activeTab: tab }),
  logbookFilterClimb: null,
  setLogbookFilterClimb: (uuid) => set({ logbookFilterClimb: uuid }),
}));

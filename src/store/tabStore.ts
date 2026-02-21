import { create } from "zustand";

export type Tab = "randomizer" | "settings";

interface TabState {
  activeTab: Tab;
  setTab: (tab: Tab) => void;
}

export const useTabStore = create<TabState>()((set) => ({
  activeTab: "randomizer",
  setTab: (tab) => set({ activeTab: tab }),
}));

import { create } from "zustand";
import type { ClimbResult } from "@/lib/db/queries";

interface DeckState {
  climbs: ClimbResult[];
  currentIndex: number;
  isShuffled: boolean;
  setDeck: (climbs: ClimbResult[]) => void;
  next: () => void;
  prev: () => void;
  goTo: (index: number) => void;
  clear: () => void;
}

export const useDeckStore = create<DeckState>()((set) => ({
  climbs: [],
  currentIndex: 0,
  isShuffled: false,
  setDeck: (climbs) => set({ climbs, currentIndex: 0, isShuffled: true }),
  next: () =>
    set((s) => ({
      currentIndex: Math.min(s.currentIndex + 1, s.climbs.length - 1),
    })),
  prev: () =>
    set((s) => ({
      currentIndex: Math.max(s.currentIndex - 1, 0),
    })),
  goTo: (index) => set({ currentIndex: index }),
  clear: () => set({ climbs: [], currentIndex: 0, isShuffled: false }),
}));

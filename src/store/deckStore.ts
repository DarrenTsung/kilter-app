import { create } from "zustand";
import type { ClimbResult } from "@/lib/db/queries";

interface DeckState {
  climbs: ClimbResult[];
  currentIndex: number;
  isShuffled: boolean;
  loggedUuids: Set<string>;
  /** Direction hint for the next animation (-1 = forward, 1 = back). */
  pendingDirection: number | null;
  /** Swipe exit direction: -1 = exits left (next), 1 = exits right (prev). */
  swipeDirection: number;
  setDeck: (climbs: ClimbResult[]) => void;
  next: () => void;
  prev: () => void;
  goTo: (index: number) => void;
  removeClimb: (uuid: string) => void;
  markLogged: (uuid: string) => void;
  clear: () => void;
}

export const useDeckStore = create<DeckState>()((set) => ({
  climbs: [],
  currentIndex: 0,
  isShuffled: false,
  loggedUuids: new Set(),
  pendingDirection: null,
  swipeDirection: -1,
  setDeck: (climbs) => set({ climbs, currentIndex: 0, isShuffled: true, loggedUuids: new Set(), pendingDirection: null, swipeDirection: -1 }),
  next: () =>
    set((s) => ({
      currentIndex: Math.min(s.currentIndex + 1, s.climbs.length - 1),
      swipeDirection: -1,
    })),
  prev: () =>
    set((s) => ({
      currentIndex: Math.max(s.currentIndex - 1, 0),
      swipeDirection: 1,
    })),
  goTo: (index) => set({ currentIndex: index }),
  removeClimb: (uuid) =>
    set((s) => {
      const idx = s.climbs.findIndex((c) => c.uuid === uuid);
      if (idx === -1) return s;
      const climbs = s.climbs.filter((c) => c.uuid !== uuid);
      return {
        climbs,
        currentIndex: Math.min(
          s.currentIndex >= idx ? Math.max(s.currentIndex - 1, 0) : s.currentIndex,
          Math.max(climbs.length - 1, 0)
        ),
        pendingDirection: -1,
      };
    }),
  markLogged: (uuid) =>
    set((s) => ({ loggedUuids: new Set(s.loggedUuids).add(uuid) })),
  clear: () => set({ climbs: [], currentIndex: 0, isShuffled: false, loggedUuids: new Set() }),
}));

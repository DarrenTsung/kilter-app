import { create } from "zustand";
import type { ClimbResult } from "@/lib/db/queries";

export type ViewMode = "filters" | "list" | "deck";

interface DeckState {
  climbs: ClimbResult[];
  currentIndex: number;
  view: ViewMode;
  loggedUuids: Set<string>;
  /** Direction hint for the next animation (-1 = forward, 1 = back). */
  pendingDirection: number | null;
  /** Swipe exit direction: -1 = exits left (next), 1 = exits right (prev). */
  swipeDirection: number;
  /** Saved sorted list for restoring after randomize from list view. */
  savedListClimbs: ClimbResult[] | null;
  /** Set deck from shuffle (filters → deck). */
  setDeck: (climbs: ClimbResult[]) => void;
  /** Set deck from sorted list (filters → list). */
  setListDeck: (climbs: ClimbResult[]) => void;
  /** Open card view from list at a specific index (list → deck). */
  openDeckFromList: (index: number) => void;
  /** Shuffle current list and enter deck, saving sorted order for restore. */
  shuffleFromList: (shuffled: ClimbResult[]) => void;
  /** Return to list view from card view (deck → list). */
  returnToList: () => void;
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
  view: "filters",
  loggedUuids: new Set(),
  pendingDirection: null,
  swipeDirection: -1,
  savedListClimbs: null,
  setDeck: (climbs) => set({ climbs, currentIndex: 0, view: "deck", loggedUuids: new Set(), pendingDirection: null, swipeDirection: -1, savedListClimbs: null }),
  setListDeck: (climbs) => set({ climbs, currentIndex: 0, view: "list", loggedUuids: new Set(), pendingDirection: null, swipeDirection: -1, savedListClimbs: null }),
  openDeckFromList: (index) => set({ currentIndex: index, view: "deck", pendingDirection: null, swipeDirection: -1 }),
  shuffleFromList: (shuffled) => set((s) => ({ climbs: shuffled, currentIndex: 0, view: "deck", pendingDirection: null, swipeDirection: -1, savedListClimbs: s.climbs })),
  returnToList: () => set((s) => ({
    view: "list",
    climbs: s.savedListClimbs ?? s.climbs,
    currentIndex: 0,
    savedListClimbs: null,
  })),
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
  clear: () => set({ climbs: [], currentIndex: 0, view: "filters", loggedUuids: new Set(), savedListClimbs: null }),
}));

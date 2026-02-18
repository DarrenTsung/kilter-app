import { create } from "zustand";
import { persist } from "zustand/middleware";

interface DislikeState {
  /** Stored as array for JSON serialization; use the methods below. */
  dislikedUuids: string[];
  dislike: (uuid: string) => void;
  undislike: (uuid: string) => void;
  isDisliked: (uuid: string) => boolean;
  clearAll: () => void;
}

export const useDislikeStore = create<DislikeState>()(
  persist(
    (set, get) => ({
      dislikedUuids: [],
      dislike: (uuid) =>
        set((s) =>
          s.dislikedUuids.includes(uuid)
            ? s
            : { dislikedUuids: [...s.dislikedUuids, uuid] }
        ),
      undislike: (uuid) =>
        set((s) => ({
          dislikedUuids: s.dislikedUuids.filter((u) => u !== uuid),
        })),
      isDisliked: (uuid) => get().dislikedUuids.includes(uuid),
      clearAll: () => set({ dislikedUuids: [] }),
    }),
    { name: "kilter-dislikes" }
  )
);

/** Helper: returns disliked UUIDs as a Set for fast lookup in queries. */
export function getDislikedSet(): Set<string> {
  return new Set(useDislikeStore.getState().dislikedUuids);
}

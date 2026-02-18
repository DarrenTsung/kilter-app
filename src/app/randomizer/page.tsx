"use client";

import { FilterPanel } from "@/components/FilterPanel";
import { SwipeDeck } from "@/components/SwipeDeck";
import { useDeckStore } from "@/store/deckStore";
import { useSyncStore } from "@/store/syncStore";
import { useAuthStore } from "@/store/authStore";
import { useFilterStore } from "@/store/filterStore";
import { queryClimbs } from "@/lib/db/queries";
import { shuffle } from "@/lib/utils/shuffle";

export default function RandomizerPage() {
  const { isShuffled, climbs, currentIndex, clear, setDeck } = useDeckStore();
  const { lastSyncedAt } = useSyncStore();
  const { isLoggedIn, userId } = useAuthStore();
  const filters = useFilterStore();

  if (!isLoggedIn) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <p className="text-neutral-400">Log in from Settings to get started.</p>
      </div>
    );
  }

  if (!lastSyncedAt) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <p className="text-neutral-400">Sync your data from Settings first.</p>
      </div>
    );
  }

  if (!isShuffled) {
    return <FilterPanel />;
  }

  if (climbs.length === 0) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-4">
        <p className="text-lg text-neutral-400">No climbs match your filters</p>
        <p className="text-sm text-neutral-500">
          Try widening the grade range or lowering the quality threshold.
        </p>
        <button
          onClick={clear}
          className="rounded-lg bg-neutral-800 px-4 py-2 text-sm transition-colors hover:bg-neutral-700"
        >
          Back to filters
        </button>
      </div>
    );
  }

  async function handleReshuffle() {
    const results = await queryClimbs(filters, userId);
    shuffle(results);
    setDeck(results);
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2">
        <button
          onClick={clear}
          className="text-sm text-neutral-400 hover:text-white"
        >
          ← Filters
        </button>
        <span className="text-sm text-neutral-500">
          {currentIndex + 1} / {climbs.length}
        </span>
        <button
          onClick={handleReshuffle}
          className="text-sm text-neutral-400 hover:text-white"
        >
          Re-shuffle
        </button>
      </div>

      {/* Swipe area */}
      <div className="flex-1 px-4 pb-4">
        <SwipeDeck />
      </div>
    </div>
  );
}

"use client";

import { FilterPanel } from "@/components/FilterPanel";
import { useDeckStore } from "@/store/deckStore";
import { useSyncStore } from "@/store/syncStore";
import { useAuthStore } from "@/store/authStore";
import { difficultyToGrade } from "@/store/filterStore";

export default function RandomizerPage() {
  const { isShuffled, climbs, currentIndex, clear } = useDeckStore();
  const { lastSyncedAt } = useSyncStore();
  const { isLoggedIn } = useAuthStore();

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

  // Deck view (placeholder — Phase 3 will add swipe cards)
  const climb = climbs[currentIndex];
  return (
    <div className="p-4">
      <div className="flex items-center justify-between">
        <button
          onClick={clear}
          className="text-sm text-neutral-400 hover:text-white"
        >
          ← Filters
        </button>
        <span className="text-sm text-neutral-500">
          {currentIndex + 1} / {climbs.length}
        </span>
      </div>

      <div className="mt-4 rounded-xl bg-neutral-800 p-4">
        <h2 className="text-xl font-bold">{climb.name}</h2>
        <p className="mt-1 text-sm text-neutral-400">
          by {climb.setter_username}
        </p>
        <div className="mt-3 flex gap-3 text-sm">
          <span className="rounded-full bg-neutral-700 px-3 py-1">
            {difficultyToGrade(climb.display_difficulty)}
          </span>
          <span className="rounded-full bg-neutral-700 px-3 py-1">
            {climb.quality_average.toFixed(1)} ★
          </span>
          <span className="rounded-full bg-neutral-700 px-3 py-1">
            {climb.ascensionist_count} sends
          </span>
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        <button
          onClick={() => useDeckStore.getState().prev()}
          disabled={currentIndex === 0}
          className="flex-1 rounded-lg bg-neutral-800 py-3 text-center font-medium transition-colors hover:bg-neutral-700 disabled:opacity-30"
        >
          ← Prev
        </button>
        <button
          onClick={() => useDeckStore.getState().next()}
          disabled={currentIndex === climbs.length - 1}
          className="flex-1 rounded-lg bg-neutral-800 py-3 text-center font-medium transition-colors hover:bg-neutral-700 disabled:opacity-30"
        >
          Next →
        </button>
      </div>
    </div>
  );
}

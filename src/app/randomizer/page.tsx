"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FilterPanel } from "@/components/FilterPanel";
import { SwipeDeck } from "@/components/SwipeDeck";
import { useDeckStore } from "@/store/deckStore";
import { useSyncStore } from "@/store/syncStore";
import { useAuthStore } from "@/store/authStore";

export default function RandomizerPage() {
  const { isShuffled, climbs, currentIndex, clear } = useDeckStore();
  const { lastSyncedAt } = useSyncStore();
  const { isLoggedIn } = useAuthStore();
  const wasShuffled = useRef(false);
  const [revealOverlay, setRevealOverlay] = useState(false);

  // When transitioning to deck, briefly show overlay then dismiss it.
  // Double RAF ensures the overlay is actually painted before we trigger the exit.
  useEffect(() => {
    if (isShuffled && climbs.length > 0) {
      if (wasShuffled.current) return;
      setRevealOverlay(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setRevealOverlay(false));
      });
    }
  }, [isShuffled, climbs.length]);

  // Push a history entry when entering deck view so Android back returns to filters
  useEffect(() => {
    if (isShuffled && !wasShuffled.current) {
      window.history.pushState({ deck: true }, "");
    }
    wasShuffled.current = isShuffled;
  }, [isShuffled]);

  useEffect(() => {
    function handlePopState() {
      if (useDeckStore.getState().isShuffled) {
        clear();
      }
    }
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [clear]);

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

  return (
    <div className="relative flex h-full flex-col">
      {/* Deck is always behind */}
      <div className="flex-1 px-4 pt-6 pb-4">
        <SwipeDeck />
      </div>
      <div className="flex items-center gap-2 px-2 py-4">
        <span className="flex-1 text-center text-sm text-neutral-500">
          {currentIndex + 1} / {climbs.length}
        </span>
      </div>

      {/* Filter panel slides down to reveal the deck underneath */}
      <AnimatePresence>
        {revealOverlay && (
          <motion.div
            key="filters-overlay"
            className="absolute inset-0 z-10 bg-neutral-900"
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
          >
            <FilterPanel />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

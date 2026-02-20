"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FilterPanel } from "@/components/FilterPanel";
import { ListView } from "@/components/ListView";
import { SwipeDeck } from "@/components/SwipeDeck";
import { useDeckStore } from "@/store/deckStore";
import { useFilterStore } from "@/store/filterStore";
import { useSyncStore } from "@/store/syncStore";
import { useAuthStore } from "@/store/authStore";

export default function RandomizerPage() {
  const { view, climbs, clear, returnToList } = useDeckStore();
  const { lastSyncedAt } = useSyncStore();
  const { isLoggedIn } = useAuthStore();
  const prevView = useRef<string>("filters");
  const [revealOverlay, setRevealOverlay] = useState(false);

  // When transitioning filters → deck (shuffle), briefly show overlay then dismiss.
  // Double RAF ensures the overlay is actually painted before we trigger the exit.
  useEffect(() => {
    if (view === "deck" && climbs.length > 0 && prevView.current === "filters") {
      setRevealOverlay(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setRevealOverlay(false));
      });
    }
  }, [view, climbs.length]);

  // Push history entry when moving forward (filters→list, filters→deck, list→deck)
  useEffect(() => {
    const prev = prevView.current;
    if (view !== prev && view !== "filters") {
      // Only push if moving forward (not when returning)
      if (
        (prev === "filters" && (view === "list" || view === "deck")) ||
        (prev === "list" && view === "deck")
      ) {
        window.history.pushState({ view }, "");
      }
    }
    prevView.current = view;
  }, [view]);

  useEffect(() => {
    function handlePopState() {
      const state = useDeckStore.getState();
      if (state.view === "deck") {
        // If we came from a sorted list, go back to list; otherwise go to filters
        const sortBy = useFilterStore.getState().sortBy;
        if (sortBy !== "random") {
          state.returnToList();
        } else {
          state.clear();
        }
      } else if (state.view === "list") {
        state.clear();
      }
    }
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

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

  if (view === "filters") {
    return <FilterPanel />;
  }

  if (view === "list") {
    return <ListView />;
  }

  // view === "deck"
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

  function handleBack() {
    window.history.back();
  }

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      {/* Back button */}
      <div className="shrink-0 px-4 pt-2 pb-4">
        <button
          onClick={handleBack}
          className="flex items-center gap-1 rounded-lg border border-neutral-600 px-3 py-1.5 text-sm font-medium text-neutral-300 active:bg-neutral-700"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back
        </button>
      </div>
      {/* Deck fills remaining space */}
      <div className="min-h-0 flex-1 px-4">
        <SwipeDeck />
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

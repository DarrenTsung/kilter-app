"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FilterPanel } from "@/components/FilterPanel";
import { ListView } from "@/components/ListView";
import { SwipeDeck } from "@/components/SwipeDeck";
import { useDeckStore, type ViewMode } from "@/store/deckStore";
import { useFilterStore } from "@/store/filterStore";
import { useTabStore } from "@/store/tabStore";
import { useSyncStore } from "@/store/syncStore";
import { useAuthStore } from "@/store/authStore";

export function RandomizerContent() {
  const { view, climbs, clear } = useDeckStore();
  const { lastSyncedAt } = useSyncStore();
  const { isLoggedIn } = useAuthStore();
  const prevView = useRef<string>("filters");
  const [revealOverlay, setRevealOverlay] = useState(false);

  // Track which views have been activated at least once (lazy mount)
  const [activated, setActivated] = useState<Record<ViewMode, boolean>>({
    filters: true,
    list: false,
    deck: false,
  });

  // Activate a view the first time it's shown
  useEffect(() => {
    if (!activated[view]) {
      setActivated((prev) => ({ ...prev, [view]: true }));
    }
  }, [view, activated]);

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
    function handlePopState(e: PopStateEvent) {
      const deckState = useDeckStore.getState();

      // If returning from a logbook/search-opened climb, go back to that tab
      const from = e.state?.from;
      if (deckState.view === "deck" && (from === "logbook" || from === "search")) {
        deckState.clear();
        useTabStore.getState().setTab(from);
        window.history.replaceState(null, "", `/${from}`);
        return;
      }

      const state = deckState;
      if (state.view === "deck") {
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
      <div className="flex h-full items-center justify-center p-4">
        <p className="text-neutral-400">Log in from Settings to get started.</p>
      </div>
    );
  }

  if (!lastSyncedAt) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <p className="text-neutral-400">Sync your data from Settings first.</p>
      </div>
    );
  }

  function handleBack() {
    window.history.back();
  }

  const showEmptyDeck = view === "deck" && climbs.length === 0;

  return (
    <div className="relative h-full">
      {/* Filters — always mounted */}
      <div className={view === "filters" ? "h-full" : "hidden"}>
        <FilterPanel />
      </div>

      {/* List — lazy mounted, hidden when not active */}
      {activated.list && (
        <div className={view === "list" ? "h-full" : "hidden"}>
          <ListView />
        </div>
      )}

      {/* Deck — lazy mounted, hidden when not active */}
      {activated.deck && (
        <div className={view === "deck" ? "h-full" : "hidden"}>
          {showEmptyDeck ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 p-4">
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
          ) : (
            <div className="flex h-full flex-col overflow-hidden">
              {/* Back button */}
              <div className="shrink-0 px-4 pt-[20.5px] pb-4">
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
            </div>
          )}
        </div>
      )}

      {/* Filter panel slides down to reveal the deck underneath */}
      <AnimatePresence>
        {revealOverlay && (
          <motion.div
            key="filters-overlay"
            className="absolute inset-0 z-10 bg-neutral-900"
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

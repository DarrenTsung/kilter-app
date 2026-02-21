"use client";

import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import {
  useFilterStore,
  difficultyToGrade,
  GRADES,
  RECENCY_OPTIONS,
  SORT_OPTIONS,
} from "@/store/filterStore";
import { useAuthStore } from "@/store/authStore";
import { useDeckStore } from "@/store/deckStore";
import { countMatchingClimbs, queryClimbs, getUserCircuits, getBlockedSet, getUserClimbGrades } from "@/lib/db/queries";
import { shuffle } from "@/lib/utils/shuffle";
import { usePresetStore, generatePresetName, type PresetFilters } from "@/store/presetStore";

// Module-level caches so data persists across view transitions
let cachedMatchCount: number | null = null;
let cachedCircuits: Array<{ uuid: string; name: string; color: string }> = [];

export function FilterPanel() {
  const filters = useFilterStore();
  const { userId } = useAuthStore();
  const { setDeck, setListDeck } = useDeckStore();
  const [matchCount, setMatchCount] = useState<number | null>(cachedMatchCount);
  const [counting, setCounting] = useState(false);
  const [shuffling, setShuffling] = useState(false);
  const [circuits, setCircuits] = useState(cachedCircuits);
  const [circuitPickerOpen, setCircuitPickerOpen] = useState(false);
  const [saveSheetOpen, setSaveSheetOpen] = useState(false);
  const [loadSheetOpen, setLoadSheetOpen] = useState(false);

  useEffect(() => {
    if (userId) getUserCircuits(userId).then((c) => { cachedCircuits = c; setCircuits(c); });
  }, [userId]);

  const selectedCircuit = circuits.find((c) => c.uuid === filters.circuitUuid);

  const updateCount = useCallback(async () => {
    setCounting(true);
    try {
      const blocked = await getBlockedSet(userId);
      const count = await countMatchingClimbs(filters, userId, blocked);
      cachedMatchCount = count;
      setMatchCount(count);
    } catch {
      cachedMatchCount = null;
      setMatchCount(null);
    } finally {
      setCounting(false);
    }
  }, [
    filters.minGrade,
    filters.maxGrade,
    filters.minQuality,
    filters.minAscents,
    filters.recencyDays,
    filters.angle,
    filters.usesAuxHolds,
    filters.usesAuxHandHolds,
    filters.circuitUuid,
    filters.hideSent,
    filters.hideAttempted,
    userId,
  ]);

  useEffect(() => {
    setCounting(true);
    const timer = setTimeout(updateCount, 300);
    return () => clearTimeout(timer);
  }, [updateCount]);

  async function handleAction() {
    setShuffling(true);
    try {
      const blocked = await getBlockedSet(userId);
      const results = await queryClimbs(filters, userId, blocked);
      if (filters.sortBy === "random") {
        shuffle(results);
        setDeck(results);
      } else {
        // Use user's grade as authoritative for sorting when available
        const { userGrades } = await getUserClimbGrades(userId, filters.angle);
        const grade = (c: typeof results[0]) => userGrades.get(c.uuid) ?? c.display_difficulty;
        if (filters.sortBy === "ascents") {
          results.sort((a, b) => b.ascensionist_count - a.ascensionist_count || grade(a) - grade(b));
        } else {
          results.sort((a, b) => grade(a) - grade(b) || b.ascensionist_count - a.ascensionist_count);
        }
        setListDeck(results);
      }
    } finally {
      setShuffling(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto px-4 pt-2 pb-4">
        {/* Circuit filter */}
        {circuits.length > 0 && (
          <button
            onClick={() => setCircuitPickerOpen(true)}
            className="flex w-full items-center gap-3 rounded-lg bg-neutral-800 px-3 mt-3 py-2.5 text-left text-sm font-medium text-white active:bg-neutral-700"
          >
            {selectedCircuit ? (
              <>
                <span
                  className="h-4 w-4 shrink-0 rounded-full"
                  style={{ backgroundColor: selectedCircuit.color }}
                />
                <span className="flex-1">{selectedCircuit.name}</span>
              </>
            ) : (
              <>
                <span className="h-4 w-4 shrink-0 rounded-full bg-neutral-400" />
                <span className="flex-1 text-neutral-200">All Climbs</span>
              </>
            )}
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 text-neutral-500">
              <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
            </svg>
          </button>
        )}

        {/* Sort mode — segmented control */}
        <div className="flex items-center justify-between">
          <span className="label shrink-0 text-sm font-medium text-neutral-400">
            Sort By
          </span>
          <div className="flex overflow-hidden rounded-lg bg-neutral-800">
            {SORT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => filters.setSortBy(opt.value)}
                className={`px-3 py-2 text-sm font-medium transition-colors ${filters.sortBy === opt.value
                  ? "bg-blue-600 text-white"
                  : "text-neutral-400 active:bg-neutral-700"
                  }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Grade Range — tap to select min/max from chip grid */}
        <Section label={filters.minGrade === filters.maxGrade ? `Grade: ${difficultyToGrade(filters.minGrade)}` : `Grade: ${difficultyToGrade(filters.minGrade)} .. ${difficultyToGrade(filters.maxGrade)}`}>
          <GradeRangeSelector
            min={filters.minGrade}
            max={filters.maxGrade}
            onChange={filters.setGradeRange}
          />
        </Section>

        {/* Quality — single row */}
        <div className="flex items-center justify-between">
          <span className="label text-sm font-medium text-neutral-400">
            Min Rating
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() =>
                filters.setMinQuality(Math.max(0, filters.minQuality - 0.5))
              }
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-neutral-800 text-lg active:bg-neutral-700"
            >
              −
            </button>
            <span className="w-10 text-center text-base font-semibold">
              {filters.minQuality.toFixed(1)}
            </span>
            <button
              onClick={() =>
                filters.setMinQuality(Math.min(5, filters.minQuality + 0.5))
              }
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-neutral-800 text-lg active:bg-neutral-700"
            >
              +
            </button>
          </div>
        </div>

        {/* Ascents — single row */}
        <div className="flex items-center justify-between">
          <span className="label text-sm font-medium text-neutral-400">
            Min Ascents
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() =>
                filters.setMinAscents(Math.max(0, filters.minAscents - 5))
              }
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-neutral-800 text-lg active:bg-neutral-700"
            >
              −
            </button>
            <span className="w-10 text-center text-base font-semibold">
              {filters.minAscents}
            </span>
            <button
              onClick={() =>
                filters.setMinAscents(Math.min(200, filters.minAscents + 5))
              }
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-neutral-800 text-lg active:bg-neutral-700"
            >
              +
            </button>
          </div>
        </div>

        {/* Logbook — hide sent/attempted */}
        <div className="flex items-center justify-between">
          <span className="label shrink-0 text-sm font-medium text-neutral-400">
            Logbook
          </span>
          <div className="flex gap-1.5">
            <ToggleButton
              active={filters.hideSent}
              onToggle={() => {
                const next = !filters.hideSent;
                filters.setHideSent(next);
                if (next) filters.setRecencyDays(0);
              }}
              label="Hide Sent"
            />
            <ToggleButton
              active={filters.hideAttempted}
              onToggle={() => {
                const next = !filters.hideAttempted;
                filters.setHideAttempted(next);
                if (next) filters.setRecencyDays(0);
              }}
              label="Hide Tried"
            />
          </div>
        </div>

        {/* Recency — single row, disabled when hiding sent/tried */}
        <div className={`flex items-center justify-between ${(filters.hideSent || filters.hideAttempted) ? "opacity-30 pointer-events-none" : ""}`}>
          <span className="label shrink-0 text-sm font-medium text-neutral-400">
            Last Send
          </span>
          <div className="flex gap-1.5">
            {RECENCY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => filters.setRecencyDays(opt.value)}
                className={`rounded-lg px-2.5 py-2 text-sm font-medium transition-colors ${filters.recencyDays === opt.value
                  ? "bg-blue-600 text-white"
                  : "bg-neutral-800 text-neutral-400 active:bg-neutral-700"
                  }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Aux holds — single row */}
        <div className="flex items-center justify-between">
          <span className="label text-sm font-medium text-neutral-400">
            Aux Holds
          </span>
          <div className="flex gap-1.5">
            <ToggleButton
              active={filters.usesAuxHolds}
              onToggle={() => filters.setUsesAuxHolds(!filters.usesAuxHolds)}
              label="Any"
            />
            <ToggleButton
              active={filters.usesAuxHandHolds}
              onToggle={() =>
                filters.setUsesAuxHandHolds(!filters.usesAuxHandHolds)
              }
              label="Any Hand"
            />
          </div>
        </div>

      </div>

      {/* Sticky bottom: match count + clear + shuffle */}
      <div className="border-t border-neutral-800 bg-neutral-900 px-4 py-3">
        <div className="mb-2 text-center text-sm text-neutral-400">
          {counting ? (
            "Calculating.."
          ) : matchCount != null ? (
            <span>
              <span className="font-semibold text-white">
                {matchCount.toLocaleString()}
              </span>{" "}
              climbs match
            </span>
          ) : (
            "Calculating.."
          )}
        </div>
        <div className="flex gap-3 pb-2">
          <div className="flex w-1/3 flex-col gap-1.5">
            <button
              onClick={filters.resetFilters}
              className="flex-1 rounded-xl border border-neutral-600 text-xs font-semibold text-neutral-300 transition-colors active:bg-neutral-700"
            >
              Clear
            </button>
            <div className="flex flex-1 overflow-hidden rounded-xl border border-neutral-600">
              <button
                onClick={() => setLoadSheetOpen(true)}
                className="flex-1 text-xs font-semibold text-neutral-300 transition-colors active:bg-neutral-700"
              >
                Load
              </button>
              <div className="w-px bg-neutral-600" />
              <button
                onClick={() => setSaveSheetOpen(true)}
                className="flex-1 text-xs font-semibold text-neutral-300 transition-colors active:bg-neutral-700"
              >
                Save
              </button>
            </div>
          </div>
          <button
            onClick={handleAction}
            disabled={shuffling || matchCount === 0}
            className="flex w-2/3 items-center justify-center gap-2 rounded-xl bg-blue-600 py-6 text-lg font-bold text-white transition-colors hover:bg-blue-500 active:bg-blue-700 disabled:opacity-50"
          >
            {filters.sortBy === "random" ? (
              <>
                {shuffling ? "Shuffling..." : (
                  <>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="2" width="20" height="20" rx="3" />
                      <circle cx="8" cy="8" r="1.5" fill="currentColor" />
                      <circle cx="16" cy="8" r="1.5" fill="currentColor" />
                      <circle cx="8" cy="16" r="1.5" fill="currentColor" />
                      <circle cx="16" cy="16" r="1.5" fill="currentColor" />
                      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
                    </svg>
                    Shuffle
                  </>
                )}
              </>
            ) : (
              <>
                {shuffling ? "Loading..." : (
                  <>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="8" y1="6" x2="21" y2="6" />
                      <line x1="8" y1="12" x2="21" y2="12" />
                      <line x1="8" y1="18" x2="21" y2="18" />
                      <line x1="3" y1="6" x2="3.01" y2="6" />
                      <line x1="3" y1="12" x2="3.01" y2="12" />
                      <line x1="3" y1="18" x2="3.01" y2="18" />
                    </svg>
                    View List
                  </>
                )}
              </>
            )}
          </button>
        </div>
      </div>

      {/* Save preset bottom sheet */}
      {saveSheetOpen && (
        <SavePresetSheet
          filters={filters}
          onClose={() => setSaveSheetOpen(false)}
        />
      )}

      {/* Load preset bottom sheet */}
      {loadSheetOpen && (
        <LoadPresetSheet
          onLoad={(preset) => {
            filters.loadFilters(preset);
            setLoadSheetOpen(false);
          }}
          onClose={() => setLoadSheetOpen(false)}
        />
      )}

      {/* Circuit picker bottom sheet */}
      {circuitPickerOpen && (
        <motion.div
          key="circuit-picker"
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60"
          onClick={() => setCircuitPickerOpen(false)}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.15 }}
        >
          <motion.div
            className="w-full max-w-md rounded-t-2xl bg-neutral-800 p-4 pb-8"
            onClick={(e) => e.stopPropagation()}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 35 }}
          >
            <h3 className="text-lg font-bold">Filter by Circuit</h3>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <button
                onClick={() => {
                  filters.setCircuitUuid(null);
                  setCircuitPickerOpen(false);
                }}
                className="rounded-full bg-neutral-600 px-3 py-1.5 text-sm font-medium text-white transition-opacity"
                style={{ opacity: filters.circuitUuid === null ? 1 : 0.3 }}
              >
                All Climbs
              </button>
              {circuits.map((c) => (
                <button
                  key={c.uuid}
                  onClick={() => {
                    filters.setCircuitUuid(c.uuid);
                    setCircuitPickerOpen(false);
                  }}
                  className="rounded-full px-3 py-1.5 text-sm font-medium text-white transition-opacity"
                  style={{
                    backgroundColor: c.color,
                    opacity: filters.circuitUuid === c.uuid ? 1 : 0.3,
                  }}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </div>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="label mb-2 text-sm font-medium text-neutral-400">{label}</p>
      {children}
    </div>
  );
}

function ToggleButton({
  active,
  onToggle,
  label,
}: {
  active: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onToggle}
      className={`rounded-lg px-2.5 py-2 text-sm font-medium transition-colors ${active
        ? "bg-blue-600 text-white"
        : "bg-neutral-800 text-neutral-400 active:bg-neutral-700"
        }`}
    >
      {label}
    </button>
  );
}

/**
 * Grade range selector using a chip grid.
 * Tap one grade to set both min and max to it.
 * Tap a second grade to set the range.
 */
function GradeRangeSelector({
  min,
  max,
  onChange,
}: {
  min: number;
  max: number;
  onChange: (min: number, max: number) => void;
}) {
  // Deduplicate grades to show one chip per V grade
  const uniqueGrades = GRADES.filter(
    (g, i) => i === 0 || GRADES[i - 1].name !== g.name
  );

  function handleTap(difficulty: number) {
    if (difficulty < min) {
      onChange(difficulty, max);
    } else if (difficulty > max) {
      onChange(min, difficulty);
    } else if (difficulty === min && difficulty === max) {
      // Already a single grade selected — do nothing
    } else if (difficulty === min) {
      onChange(difficulty + 1 <= max ? difficulty + 1 : difficulty, max);
    } else if (difficulty === max) {
      onChange(min, difficulty - 1 >= min ? difficulty - 1 : difficulty);
    } else {
      // Tapped inside range — set as new single point, user taps again to expand
      onChange(difficulty, difficulty);
    }
  }

  return (
    <div className="grid grid-cols-6 gap-1">
      {uniqueGrades.map((g) => {
        // A grade chip represents a range of difficulty values with the same name.
        // Find the full range for this display name.
        const gradesForName = GRADES.filter((gr) => gr.name === g.name);
        const low = gradesForName[0].difficulty;
        const high = gradesForName[gradesForName.length - 1].difficulty;
        const isInRange = high >= min && low <= max;

        return (
          <button
            key={g.difficulty}
            onClick={() => handleTap(g.difficulty)}
            className={`rounded-sm py-1 text-sm font-medium transition-colors ${isInRange
              ? "bg-blue-600 text-white"
              : "bg-neutral-800 text-neutral-500 active:bg-neutral-700"
              }`}
          >
            {g.name}
          </button>
        );
      })}
    </div>
  );
}

function extractPresetFilters(filters: ReturnType<typeof useFilterStore.getState>): PresetFilters {
  return {
    minGrade: filters.minGrade,
    maxGrade: filters.maxGrade,
    minQuality: filters.minQuality,
    minAscents: filters.minAscents,
    recencyDays: filters.recencyDays,
    angle: filters.angle,
    usesAuxHolds: filters.usesAuxHolds,
    usesAuxHandHolds: filters.usesAuxHandHolds,
    circuitUuid: filters.circuitUuid,
  };
}

function SavePresetSheet({
  filters,
  onClose,
}: {
  filters: ReturnType<typeof useFilterStore.getState>;
  onClose: () => void;
}) {
  const current = extractPresetFilters(filters);
  const [name, setName] = useState(generatePresetName(current));
  const { savePreset } = usePresetStore();
  const [open, setOpen] = useState(false);

  useEffect(() => { setOpen(true); }, []);

  const animateClose = useCallback(() => {
    setOpen(false);
    setTimeout(onClose, 200);
  }, [onClose]);

  return (
    <motion.div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60"
      onClick={animateClose}
      animate={{ opacity: open ? 1 : 0 }}
      transition={{ duration: 0.15 }}
    >
      <motion.div
        className="w-full max-w-md rounded-t-2xl bg-neutral-800 p-4 pb-8"
        onClick={(e) => e.stopPropagation()}
        animate={{ y: open ? 0 : "100%" }}
        transition={{ type: "spring", stiffness: 400, damping: 35 }}
      >
        <h3 className="text-lg font-bold">Save Preset</h3>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-3 w-full rounded-lg bg-neutral-700 px-3 py-2.5 text-sm text-white placeholder-neutral-500 outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Preset name"
        />
        <button
          onClick={() => {
            savePreset(name.trim() || "Untitled", current);
            onClose();
          }}
          className="mt-3 w-full rounded-xl bg-blue-600 py-3 text-base font-bold text-white active:bg-blue-700"
        >
          Save
        </button>
      </motion.div>
    </motion.div>
  );
}

function LoadPresetSheet({
  onLoad,
  onClose,
}: {
  onLoad: (filters: PresetFilters) => void;
  onClose: () => void;
}) {
  const { presets, deletePreset } = usePresetStore();
  const [open, setOpen] = useState(false);

  useEffect(() => { setOpen(true); }, []);

  const animateClose = useCallback(() => {
    setOpen(false);
    setTimeout(onClose, 200);
  }, [onClose]);

  return (
    <motion.div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60"
      onClick={animateClose}
      animate={{ opacity: open ? 1 : 0 }}
      transition={{ duration: 0.15 }}
    >
      <motion.div
        className="w-full max-w-md rounded-t-2xl bg-neutral-800 p-4 pb-8"
        onClick={(e) => e.stopPropagation()}
        animate={{ y: open ? 0 : "100%" }}
        transition={{ type: "spring", stiffness: 400, damping: 35 }}
      >
        <h3 className="text-lg font-bold">Load Preset</h3>
        {presets.length === 0 ? (
          <p className="mt-3 text-sm text-neutral-400">No saved presets yet.</p>
        ) : (
          <div className="mt-3 flex max-h-64 flex-col gap-1.5 overflow-y-auto">
            {presets.map((p) => (
              <div key={p.id} className="flex items-center gap-2">
                <button
                  onClick={() => onLoad(p.filters)}
                  className="flex-1 rounded-lg bg-neutral-700 px-3 py-2.5 text-left text-sm font-medium text-white active:bg-neutral-600"
                >
                  {p.name}
                </button>
                <button
                  onClick={() => deletePreset(p.id)}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-neutral-500 active:bg-neutral-700 active:text-red-400"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                    <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

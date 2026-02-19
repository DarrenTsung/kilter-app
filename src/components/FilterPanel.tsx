"use client";

import { useEffect, useState, useCallback } from "react";
import {
  useFilterStore,
  difficultyToGrade,
  GRADES,
  RECENCY_OPTIONS,
} from "@/store/filterStore";
import { useAuthStore } from "@/store/authStore";
import { useDeckStore } from "@/store/deckStore";
import { countMatchingClimbs, queryClimbs, getUserCircuits } from "@/lib/db/queries";
import { shuffle } from "@/lib/utils/shuffle";
import { getDislikedSet, useDislikeStore } from "@/store/dislikeStore";

export function FilterPanel() {
  const filters = useFilterStore();
  const { userId } = useAuthStore();
  const { setDeck } = useDeckStore();
  const dislikeCount = useDislikeStore((s) => s.dislikedUuids.length);
  const [matchCount, setMatchCount] = useState<number | null>(null);
  const [counting, setCounting] = useState(false);
  const [shuffling, setShuffling] = useState(false);
  const [circuits, setCircuits] = useState<Array<{ uuid: string; name: string; color: string }>>([]);

  useEffect(() => {
    if (userId) getUserCircuits(userId).then(setCircuits);
  }, [userId]);

  const updateCount = useCallback(async () => {
    setCounting(true);
    try {
      const count = await countMatchingClimbs(filters, userId, getDislikedSet());
      setMatchCount(count);
    } catch {
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
    userId,
    dislikeCount,
  ]);

  useEffect(() => {
    const timer = setTimeout(updateCount, 300);
    return () => clearTimeout(timer);
  }, [updateCount]);

  async function handleShuffle() {
    setShuffling(true);
    try {
      const results = await queryClimbs(filters, userId, getDislikedSet());
      shuffle(results);
      setDeck(results);
    } finally {
      setShuffling(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-6 overflow-y-auto px-4 pt-4 pb-4">
        {/* Circuit filter */}
        {circuits.length > 0 && (
          <Section label="Circuit">
            <div className="flex gap-2 overflow-x-auto pb-1">
              <button
                onClick={() => filters.setCircuitUuid(null)}
                className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                  filters.circuitUuid === null
                    ? "bg-blue-600 text-white"
                    : "bg-neutral-800 text-neutral-400 active:bg-neutral-700"
                }`}
              >
                All
              </button>
              {circuits.map((c) => (
                <button
                  key={c.uuid}
                  onClick={() => filters.setCircuitUuid(c.uuid)}
                  className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                    filters.circuitUuid === c.uuid
                      ? "ring-2 ring-white text-white"
                      : "text-white/80 active:brightness-125"
                  }`}
                  style={{ backgroundColor: c.color }}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </Section>
        )}

        {/* Grade Range — tap to select min/max from chip grid */}
        <Section label={`Grade: ${difficultyToGrade(filters.minGrade)} – ${difficultyToGrade(filters.maxGrade)}`}>
          <GradeRangeSelector
            min={filters.minGrade}
            max={filters.maxGrade}
            onChange={filters.setGradeRange}
          />
        </Section>

        {/* Quality & Ascents side-by-side */}
        <div className="grid grid-cols-2 gap-4">
          <Section label={`Quality ≥ ${filters.minQuality.toFixed(1)}★`}>
            <div className="flex items-center gap-2">
              <button
                onClick={() =>
                  filters.setMinQuality(Math.max(0, filters.minQuality - 0.5))
                }
                className="flex h-10 w-10 items-center justify-center rounded-lg bg-neutral-800 text-lg active:bg-neutral-700"
              >
                −
              </button>
              <span className="flex-1 text-center text-lg font-semibold">
                {filters.minQuality.toFixed(1)}
              </span>
              <button
                onClick={() =>
                  filters.setMinQuality(Math.min(5, filters.minQuality + 0.5))
                }
                className="flex h-10 w-10 items-center justify-center rounded-lg bg-neutral-800 text-lg active:bg-neutral-700"
              >
                +
              </button>
            </div>
          </Section>

          <Section label={`Ascents ≥ ${filters.minAscents}`}>
            <div className="flex items-center gap-2">
              <button
                onClick={() =>
                  filters.setMinAscents(Math.max(0, filters.minAscents - 5))
                }
                className="flex h-10 w-10 items-center justify-center rounded-lg bg-neutral-800 text-lg active:bg-neutral-700"
              >
                −
              </button>
              <span className="flex-1 text-center text-lg font-semibold">
                {filters.minAscents}
              </span>
              <button
                onClick={() =>
                  filters.setMinAscents(Math.min(200, filters.minAscents + 5))
                }
                className="flex h-10 w-10 items-center justify-center rounded-lg bg-neutral-800 text-lg active:bg-neutral-700"
              >
                +
              </button>
            </div>
          </Section>
        </div>

        {/* Recency */}
        <Section label="Exclude recently sent">
          <div className="grid grid-cols-4 gap-2">
            {RECENCY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => filters.setRecencyDays(opt.value)}
                className={`rounded-lg py-2.5 text-sm font-medium transition-colors ${
                  filters.recencyDays === opt.value
                    ? "bg-blue-600 text-white"
                    : "bg-neutral-800 text-neutral-400 active:bg-neutral-700"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </Section>

        {/* Aux Hold Filters */}
        <Section label="Auxiliary Holds">
          <div className="grid grid-cols-2 gap-2">
            <ToggleButton
              active={filters.usesAuxHolds}
              onToggle={() => filters.setUsesAuxHolds(!filters.usesAuxHolds)}
              label="Any Aux Holds"
            />
            <ToggleButton
              active={filters.usesAuxHandHolds}
              onToggle={() =>
                filters.setUsesAuxHandHolds(!filters.usesAuxHandHolds)
              }
              label="Any Aux Hand Holds"
            />
          </div>
        </Section>
      </div>

      {/* Sticky bottom: match count + clear + shuffle */}
      <div className="border-t border-neutral-800 bg-neutral-900 px-4 py-3">
        <div className="mb-2 text-center text-sm text-neutral-400">
          {counting ? (
            "Counting..."
          ) : matchCount !== null ? (
            <span>
              <span className="font-semibold text-white">
                {matchCount.toLocaleString()}
              </span>{" "}
              climbs match
            </span>
          ) : null}
        </div>
        <div className="flex gap-3">
          <button
            onClick={filters.resetFilters}
            className="rounded-xl bg-neutral-700 px-5 py-3.5 text-lg font-bold text-white transition-colors active:bg-neutral-600"
          >
            Clear
          </button>
          <button
            onClick={handleShuffle}
            disabled={shuffling || matchCount === 0}
            className="flex-1 rounded-xl bg-blue-600 py-3.5 text-lg font-bold text-white transition-colors hover:bg-blue-500 active:bg-blue-700 disabled:opacity-50"
          >
            {shuffling ? "Shuffling..." : "Shuffle"}
          </button>
        </div>
      </div>
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
      <p className="mb-2 text-sm font-medium text-neutral-400">{label}</p>
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
      className={`rounded-lg py-2.5 text-sm font-medium transition-colors ${
        active
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
    <div className="grid grid-cols-6 gap-1.5">
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
            className={`rounded-lg py-2 text-sm font-medium transition-colors ${
              isInRange
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

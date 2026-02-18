"use client";

import { useEffect, useState, useCallback } from "react";
import { useFilterStore, difficultyToGrade, ANGLES, RECENCY_OPTIONS } from "@/store/filterStore";
import { useAuthStore } from "@/store/authStore";
import { useDeckStore } from "@/store/deckStore";
import { countMatchingClimbs, queryClimbs } from "@/lib/db/queries";
import { shuffle } from "@/lib/utils/shuffle";

export function FilterPanel() {
  const filters = useFilterStore();
  const { userId } = useAuthStore();
  const { setDeck } = useDeckStore();
  const [matchCount, setMatchCount] = useState<number | null>(null);
  const [counting, setCounting] = useState(false);
  const [shuffling, setShuffling] = useState(false);

  // Debounced match count
  const updateCount = useCallback(async () => {
    setCounting(true);
    try {
      const count = await countMatchingClimbs(filters, userId);
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
    userId,
  ]);

  useEffect(() => {
    const timer = setTimeout(updateCount, 300);
    return () => clearTimeout(timer);
  }, [updateCount]);

  async function handleShuffle() {
    setShuffling(true);
    try {
      const results = await queryClimbs(filters, userId);
      shuffle(results);
      setDeck(results);
    } finally {
      setShuffling(false);
    }
  }

  return (
    <div className="space-y-5 p-4">
      {/* Grade Range */}
      <div>
        <label className="text-sm font-medium text-neutral-300">
          Grade: {difficultyToGrade(filters.minGrade)} – {difficultyToGrade(filters.maxGrade)}
        </label>
        <div className="mt-2 flex items-center gap-3">
          <span className="text-xs text-neutral-500">
            {difficultyToGrade(filters.minGrade)}
          </span>
          <input
            type="range"
            min={10}
            max={33}
            value={filters.minGrade}
            onChange={(e) => {
              const val = Number(e.target.value);
              filters.setGradeRange(val, Math.max(val, filters.maxGrade));
            }}
            className="flex-1 accent-blue-500"
          />
          <input
            type="range"
            min={10}
            max={33}
            value={filters.maxGrade}
            onChange={(e) => {
              const val = Number(e.target.value);
              filters.setGradeRange(Math.min(filters.minGrade, val), val);
            }}
            className="flex-1 accent-blue-500"
          />
          <span className="text-xs text-neutral-500">
            {difficultyToGrade(filters.maxGrade)}
          </span>
        </div>
      </div>

      {/* Angle */}
      <div>
        <label className="text-sm font-medium text-neutral-300">
          Angle: {filters.angle}°
        </label>
        <div className="mt-2 flex flex-wrap gap-2">
          {ANGLES.map((a) => (
            <button
              key={a}
              onClick={() => filters.setAngle(a)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                filters.angle === a
                  ? "bg-blue-600 text-white"
                  : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700"
              }`}
            >
              {a}°
            </button>
          ))}
        </div>
      </div>

      {/* Min Quality */}
      <div>
        <label className="text-sm font-medium text-neutral-300">
          Min Quality: {filters.minQuality.toFixed(1)} stars
        </label>
        <input
          type="range"
          min={0}
          max={5}
          step={0.5}
          value={filters.minQuality}
          onChange={(e) => filters.setMinQuality(Number(e.target.value))}
          className="mt-2 w-full accent-blue-500"
        />
      </div>

      {/* Min Ascents */}
      <div>
        <label className="text-sm font-medium text-neutral-300">
          Min Ascents: {filters.minAscents}
        </label>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={filters.minAscents}
          onChange={(e) => filters.setMinAscents(Number(e.target.value))}
          className="mt-2 w-full accent-blue-500"
        />
      </div>

      {/* Recency */}
      <div>
        <label className="text-sm font-medium text-neutral-300">
          Exclude recently sent
        </label>
        <div className="mt-2 flex flex-wrap gap-2">
          {RECENCY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => filters.setRecencyDays(opt.value)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                filters.recencyDays === opt.value
                  ? "bg-blue-600 text-white"
                  : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Aux Hold Filters */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-neutral-300">
          Auxiliary Holds
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={filters.usesAuxHolds}
            onChange={(e) => filters.setUsesAuxHolds(e.target.checked)}
            className="accent-blue-500"
          />
          <span className="text-sm text-neutral-400">Uses aux holds</span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={filters.usesAuxHandHolds}
            onChange={(e) => filters.setUsesAuxHandHolds(e.target.checked)}
            className="accent-blue-500"
          />
          <span className="text-sm text-neutral-400">Uses aux hand holds</span>
        </label>
      </div>

      {/* Match Count */}
      <div className="text-center text-sm text-neutral-400">
        {counting ? (
          "Counting..."
        ) : matchCount !== null ? (
          <span>
            <span className="font-semibold text-white">{matchCount.toLocaleString()}</span>{" "}
            climbs match
          </span>
        ) : null}
      </div>

      {/* Shuffle Button */}
      <button
        onClick={handleShuffle}
        disabled={shuffling || matchCount === 0}
        className="w-full rounded-xl bg-blue-600 py-3 text-lg font-bold text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
      >
        {shuffling ? "Shuffling..." : "Shuffle"}
      </button>
    </div>
  );
}

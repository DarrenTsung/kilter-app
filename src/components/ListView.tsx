"use client";

import { useEffect, useState } from "react";
import { useDeckStore } from "@/store/deckStore";
import { useAuthStore } from "@/store/authStore";
import { useFilterStore, difficultyToGrade, FILTER_DEFAULTS, type SortMode } from "@/store/filterStore";
import { usePresetStore, type PresetFilters } from "@/store/presetStore";
import { getCircuitMap, getUserClimbGrades, getBetaClimbUuids, getUserCircuits, type CircuitInfo } from "@/lib/db/queries";
import { shuffle } from "@/lib/utils/shuffle";

// Module-level caches so data persists across view transitions
let cachedSentUuids: Set<string> = new Set();
let cachedUserGrades: Map<string, number> = new Map();
let cachedBetaUuids: Set<string> = new Set();
let cachedCircuitMap: Map<string, CircuitInfo[]> = new Map();
let cachedCircuits: Array<{ uuid: string; name: string; color: string }> = [];
let cachedForKey: string | null = null; // "userId-angle" to invalidate on change

export function ListView() {
  const { climbs, clear, openDeckFromList } = useDeckStore();
  const userId = useAuthStore((s) => s.userId);
  const filters = useFilterStore();
  const angle = filters.angle;
  const cacheKey = `${userId}-${angle}`;

  const [sentUuids, setSentUuids] = useState(cachedSentUuids);
  const [userGrades, setUserGrades] = useState(cachedUserGrades);
  const [betaUuids, setBetaUuids] = useState(cachedBetaUuids);
  const [circuitMap, setCircuitMap] = useState(cachedCircuitMap);
  const [circuits, setCircuits] = useState(cachedCircuits);

  useEffect(() => {
    // Skip reload if cache is valid for same userId+angle
    if (cachedForKey === cacheKey && cachedSentUuids.size > 0) return;

    getUserClimbGrades(userId, angle).then(({ sentUuids: s, userGrades: g }) => {
      cachedSentUuids = s;
      cachedUserGrades = g;
      setSentUuids(s);
      setUserGrades(g);
    });
    getBetaClimbUuids().then((b) => { cachedBetaUuids = b; setBetaUuids(b); });
    getCircuitMap().then((m) => { cachedCircuitMap = m; setCircuitMap(m); });
    if (userId) getUserCircuits(userId).then((c) => { cachedCircuits = c; setCircuits(c); });
    cachedForKey = cacheKey;
  }, [userId, angle, cacheKey]);

  // Check if current filters match a saved preset
  const { presets } = usePresetStore();
  const currentPreset: PresetFilters = {
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
  const matchingPreset = presets.find((p) => {
    const f = p.filters;
    return f.minGrade === currentPreset.minGrade
      && f.maxGrade === currentPreset.maxGrade
      && f.minQuality === currentPreset.minQuality
      && f.minAscents === currentPreset.minAscents
      && f.recencyDays === currentPreset.recencyDays
      && f.angle === currentPreset.angle
      && f.usesAuxHolds === currentPreset.usesAuxHolds
      && f.usesAuxHandHolds === currentPreset.usesAuxHandHolds
      && f.circuitUuid === currentPreset.circuitUuid;
  });

  // Build a short filter description, or use preset name if matched
  const selectedCircuit = filters.circuitUuid ? circuits.find((c) => c.uuid === filters.circuitUuid) : null;
  let filterDesc: string;
  if (matchingPreset) {
    filterDesc = matchingPreset.name;
  } else {
    const descParts: string[] = [];
    const d = FILTER_DEFAULTS;
    if (filters.minGrade !== d.minGrade || filters.maxGrade !== d.maxGrade) {
      const minName = difficultyToGrade(filters.minGrade);
      const maxName = difficultyToGrade(filters.maxGrade);
      descParts.push(minName === maxName ? minName : `${minName}–${maxName}`);
    }
    filterDesc = descParts.join(" · ");
  }

  const [sortOpen, setSortOpen] = useState(false);
  const { setDeck, setListDeck: setListDeckStore } = useDeckStore();

  const sortLabel = filters.sortBy === "ascents" ? "Sends" : "Grade";

  function handleTap(index: number) {
    window.history.pushState({ deck: true }, "");
    openDeckFromList(index);
  }

  function resortClimbs(mode: SortMode) {
    filters.setSortBy(mode);
    const sorted = [...climbs];
    const grade = (c: typeof climbs[0]) => userGrades.get(c.uuid) ?? c.display_difficulty;
    if (mode === "ascents") {
      sorted.sort((a, b) => b.ascensionist_count - a.ascensionist_count || grade(a) - grade(b));
    } else {
      sorted.sort((a, b) => grade(a) - grade(b) || b.ascensionist_count - a.ascensionist_count);
    }
    setListDeckStore(sorted);
    setSortOpen(false);
  }

  function handleRandomize() {
    setSortOpen(false);
    const shuffled = [...climbs];
    shuffle(shuffled);
    setDeck(shuffled);
  }

  return (
    <div className="flex h-full flex-col">
      {/* Sticky header */}
      <div className="flex h-[75.5px] shrink-0 items-center border-b border-neutral-800 bg-neutral-900 px-4">
        <button
          onClick={clear}
          className="flex items-center gap-1 rounded-lg border border-neutral-600 px-3 py-1.5 text-sm font-medium text-neutral-300 active:bg-neutral-700"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back
        </button>
        <div className="flex-1 flex flex-col items-center gap-0.5">
          <div className="flex items-center gap-1.5">
            {selectedCircuit && (
              <span
                className="rounded-full px-2.5 py-0.5 text-md font-bold text-white mt-1.5"
                style={{ backgroundColor: selectedCircuit.color }}
              >
                {selectedCircuit.name}
              </span>
            )}
            <p className="text-md font-normal uppercase text-neutral-300">{filterDesc}</p>
          </div>
          <p className="text-[11px] uppercase text-neutral-500">{climbs.length.toLocaleString()} climbs</p>
        </div>
        {/* Sort dropdown — wrapper height matches button so it centers in the header */}
        <div className="relative h-[34px] w-24">
          {sortOpen && <div className="fixed inset-0 z-40" onClick={() => setSortOpen(false)} />}
          <div className="absolute right-0 top-0 z-50 w-26 overflow-hidden rounded-lg border border-neutral-600 bg-neutral-800">
            <button
              onClick={() => setSortOpen(!sortOpen)}
              className="flex w-full items-center justify-between px-2 py-1.5 text-sm font-medium text-neutral-300 active:bg-neutral-700"
            >
              {sortLabel}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${sortOpen ? "rotate-180" : ""}`}>
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {sortOpen && (
              <>
                {filters.sortBy !== "ascents" && (
                  <button
                    onClick={() => resortClimbs("ascents")}
                    className="flex w-full items-center px-2 py-2 text-sm text-neutral-400 active:bg-neutral-700"
                  >
                    Sends
                  </button>
                )}
                {filters.sortBy !== "grade" && (
                  <button
                    onClick={() => resortClimbs("grade")}
                    className="flex w-full items-center px-2 py-2 text-sm text-neutral-400 active:bg-neutral-700"
                  >
                    Grade
                  </button>
                )}
                <div className="border-t border-neutral-700" />
                <button
                  onClick={handleRandomize}
                  className="flex w-full items-center gap-1 px-2 py-2 text-sm text-neutral-400 active:bg-neutral-700"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="2" width="20" height="20" rx="3" />
                    <circle cx="8" cy="8" r="1.5" fill="currentColor" />
                    <circle cx="16" cy="8" r="1.5" fill="currentColor" />
                    <circle cx="8" cy="16" r="1.5" fill="currentColor" />
                    <circle cx="16" cy="16" r="1.5" fill="currentColor" />
                    <circle cx="12" cy="12" r="1.5" fill="currentColor" />
                  </svg>
                  Random
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Scrollable list */}
      <div className="flex-1 overflow-y-auto">
        {climbs.map((climb, i) => {
          const circuits = circuitMap.get(climb.uuid);
          const isSent = sentUuids.has(climb.uuid);
          const hasBeta = betaUuids.has(climb.uuid);
          const userGrade = userGrades.get(climb.uuid);
          const hasCustomGrade = userGrade != null && difficultyToGrade(userGrade) !== difficultyToGrade(climb.display_difficulty);

          return (
            <button
              key={climb.uuid}
              onClick={() => handleTap(i)}
              className="flex w-full items-start gap-2 border-b border-neutral-800/50 px-4 py-3 text-left active:bg-neutral-800/50"
            >
              {/* Left icon area: fixed positions so beta icon doesn't shift */}
              <div className="relative w-3 shrink-0" style={{ minHeight: "28px" }}>
                {isSent && (
                  <svg className="absolute left-0 top-1" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#737373" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
                {hasBeta && (
                  <svg className="absolute left-[1px] top-[23px]" width="10" height="10" viewBox="0 0 24 24" fill="#737373">
                    <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
                  </svg>
                )}
              </div>

              {/* Middle: name, setter, ascents, circuits */}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-white">
                  {climb.name}
                </p>
                <p className="truncate text-[11px] text-neutral-500">
                  {climb.setter_username}
                </p>
                {circuits && circuits.length > 0 && (
                  <div className="-ml-1 mt-1 flex flex-wrap gap-1">
                    {circuits.map((c) => (
                      <span
                        key={c.uuid}
                        className="rounded-full px-1.5 py-0.5 text-[12px] font-medium normal-case tracking-normal leading-tight text-white/80"
                        style={{ backgroundColor: c.color }}
                      >
                        {c.name.toLowerCase()}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Right: grade, ascents, rating */}
              <div className="shrink-0 text-right">
                <div className="flex items-center justify-end gap-1">
                  {hasCustomGrade && (
                    <span className="rounded bg-blue-600/20 px-1.5 py-0.5 text-xs font-bold text-blue-400 line-through opacity-50">
                      {difficultyToGrade(climb.display_difficulty)}
                    </span>
                  )}
                  <span className={`rounded px-1.5 py-0.5 text-xs font-bold ${hasCustomGrade ? "bg-orange-600/20 text-orange-400" : "bg-blue-600/20 text-blue-400"}`}>
                    {difficultyToGrade(hasCustomGrade ? userGrade : climb.display_difficulty)}
                  </span>
                </div>
                <p className="mt-1 text-[10px] text-neutral-500">
                  {climb.ascensionist_count.toLocaleString()} · {"★".repeat(Math.round(climb.quality_average))} {climb.quality_average.toFixed(1)}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

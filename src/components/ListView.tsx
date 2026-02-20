"use client";

import { useEffect, useState } from "react";
import { useDeckStore } from "@/store/deckStore";
import { useAuthStore } from "@/store/authStore";
import { useFilterStore, difficultyToGrade, FILTER_DEFAULTS } from "@/store/filterStore";
import { usePresetStore, type PresetFilters } from "@/store/presetStore";
import { getCircuitMap, getUserClimbGrades, getBetaClimbUuids, getUserCircuits, type CircuitInfo } from "@/lib/db/queries";

export function ListView() {
  const { climbs, clear, openDeckFromList } = useDeckStore();
  const userId = useAuthStore((s) => s.userId);
  const filters = useFilterStore();
  const angle = filters.angle;
  const [sentUuids, setSentUuids] = useState<Set<string>>(new Set());
  const [userGrades, setUserGrades] = useState<Map<string, number>>(new Map());
  const [betaUuids, setBetaUuids] = useState<Set<string>>(new Set());
  const [circuitMap, setCircuitMap] = useState<Map<string, CircuitInfo[]>>(new Map());
  const [circuits, setCircuits] = useState<Array<{ uuid: string; name: string; color: string }>>([]);

  useEffect(() => {
    getUserClimbGrades(userId, angle).then(({ sentUuids, userGrades }) => {
      setSentUuids(sentUuids);
      setUserGrades(userGrades);
    });
    getBetaClimbUuids().then(setBetaUuids);
    getCircuitMap().then(setCircuitMap);
    if (userId) getUserCircuits(userId).then(setCircuits);
  }, [userId, angle]);

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
    if (filters.sortBy === "ascents") descParts.push("by ascents");
    else if (filters.sortBy === "grade") descParts.push("by grade");
    filterDesc = descParts.join(" · ");
  }

  function handleTap(index: number) {
    window.history.pushState({ deck: true }, "");
    openDeckFromList(index);
  }

  return (
    <div className="flex h-full flex-col">
      {/* Sticky header */}
      <div className="flex items-center border-b border-neutral-800 bg-neutral-900 px-4 py-4">
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
                className="rounded-full px-2.5 py-0.5 text-sm font-bold text-white"
                style={{ backgroundColor: selectedCircuit.color }}
              >
                {selectedCircuit.name}
              </span>
            )}
            <p className="text-sm font-normal uppercase text-neutral-300">{filterDesc}</p>
          </div>
          <p className="text-xs uppercase text-neutral-500">{climbs.length.toLocaleString()} climbs</p>
        </div>
        {/* Spacer to balance the back button */}
        <div className="w-16" />
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
              {/* Left icon area: checkmark or beta */}
              <div className="flex w-3 shrink-0 flex-col items-center gap-1.5 pt-1">
                {isSent && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#737373" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
                {hasBeta && (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="#737373">
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
                  <div className="mt-1 flex flex-wrap gap-1">
                    {circuits.map((c) => (
                      <span
                        key={c.uuid}
                        className="rounded-full px-1.5 py-0.5 text-[10px] font-medium normal-case tracking-normal leading-tight text-white/80"
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

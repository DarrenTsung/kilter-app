import { create } from "zustand";
import { persist } from "zustand/middleware";
import { FILTER_DEFAULTS, difficultyToGrade } from "./filterStore";

export interface PresetFilters {
  minGrade: number;
  maxGrade: number;
  minQuality: number;
  minAscents: number;
  recencyDays: number;
  angle: number;
  usesAuxHolds: boolean;
  usesAuxHandHolds: boolean;
  circuitUuid: string | null;
}

export interface FilterPreset {
  id: string;
  name: string;
  filters: PresetFilters;
}

interface PresetState {
  presets: FilterPreset[];
  savePreset: (name: string, filters: PresetFilters) => void;
  deletePreset: (id: string) => void;
}

export const usePresetStore = create<PresetState>()(
  persist(
    (set) => ({
      presets: [],
      savePreset: (name, filters) =>
        set((state) => ({
          presets: [
            ...state.presets,
            { id: crypto.randomUUID(), name, filters },
          ],
        })),
      deletePreset: (id) =>
        set((state) => ({
          presets: state.presets.filter((p) => p.id !== id),
        })),
    }),
    { name: "kilter-presets" }
  )
);

/** Build a short auto-generated name from filter values, showing only non-default parts. */
export function generatePresetName(filters: PresetFilters): string {
  const parts: string[] = [];
  const d = FILTER_DEFAULTS;

  // Grade range
  if (filters.minGrade !== d.minGrade || filters.maxGrade !== d.maxGrade) {
    const minName = difficultyToGrade(filters.minGrade);
    const maxName = difficultyToGrade(filters.maxGrade);
    parts.push(minName === maxName ? minName : `${minName}–${maxName}`);
  }

  if (filters.minQuality > 0) parts.push(`★${filters.minQuality.toFixed(1)}`);
  if (filters.minAscents > 0) parts.push(`${filters.minAscents}+ sends`);
  if (filters.usesAuxHolds) parts.push("Aux");
  if (filters.usesAuxHandHolds) parts.push("Aux Hands");

  return parts.length > 0 ? parts.join(" ") : "All Climbs";
}

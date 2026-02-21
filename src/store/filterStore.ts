import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { PresetFilters } from "./presetStore";

export type SortMode = "random" | "ascents" | "grade";

export const SORT_OPTIONS: { label: string; value: SortMode }[] = [
  { label: "Random", value: "random" },
  { label: "Ascents", value: "ascents" },
  { label: "Grade", value: "grade" },
];

export const FILTER_DEFAULTS = {
  minGrade: 10, // V0-
  maxGrade: 33, // V16
  minQuality: 0,
  minAscents: 0,
  recencyDays: 0,
  angle: 40,
  usesAuxHolds: false,
  usesAuxHandHolds: false,
  autoDisconnect: 0,
  circuitUuid: null as string | null,
  sortBy: "ascents" as SortMode,
  hideSent: false,
  hideAttempted: false,
} as const;

export interface FilterState {
  // Grade range (difficulty values, not V-scale)
  minGrade: number;
  maxGrade: number;
  // Quality
  minQuality: number;
  // Ascensionist count
  minAscents: number;
  // Recency: exclude climbs sent within this many days (0 = no filter)
  recencyDays: number;
  // Board angle
  angle: number;
  // Aux hold filters (homewall only)
  usesAuxHolds: boolean;
  usesAuxHandHolds: boolean;
  // BLE auto-disconnect timeout in seconds (0 = off / stay connected)
  autoDisconnect: number;
  // Circuit filter (null = all climbs)
  circuitUuid: string | null;
  // Sort mode
  sortBy: SortMode;
  // Logbook exclusion filters
  hideSent: boolean;
  hideAttempted: boolean;

  setGradeRange: (min: number, max: number) => void;
  setMinQuality: (val: number) => void;
  setMinAscents: (val: number) => void;
  setRecencyDays: (val: number) => void;
  setAngle: (val: number) => void;
  setUsesAuxHolds: (val: boolean) => void;
  setUsesAuxHandHolds: (val: boolean) => void;
  setAutoDisconnect: (val: number) => void;
  setCircuitUuid: (val: string | null) => void;
  setSortBy: (val: SortMode) => void;
  setHideSent: (val: boolean) => void;
  setHideAttempted: (val: boolean) => void;
  resetFilters: () => void;
  loadFilters: (values: PresetFilters) => void;
}

export const useFilterStore = create<FilterState>()(
  persist(
    (set) => ({
      ...FILTER_DEFAULTS,

      setGradeRange: (minGrade, maxGrade) => set({ minGrade, maxGrade }),
      setMinQuality: (minQuality) => set({ minQuality }),
      setMinAscents: (minAscents) => set({ minAscents }),
      setRecencyDays: (recencyDays) => set({ recencyDays }),
      setAngle: (angle) => set({ angle }),
      setUsesAuxHolds: (usesAuxHolds) => set({ usesAuxHolds }),
      setUsesAuxHandHolds: (usesAuxHandHolds) => set({ usesAuxHandHolds }),
      setAutoDisconnect: (autoDisconnect) => set({ autoDisconnect }),
      setCircuitUuid: (circuitUuid) => set({
        circuitUuid,
        minGrade: FILTER_DEFAULTS.minGrade,
        maxGrade: FILTER_DEFAULTS.maxGrade,
        minQuality: FILTER_DEFAULTS.minQuality,
        minAscents: FILTER_DEFAULTS.minAscents,
        recencyDays: FILTER_DEFAULTS.recencyDays,
        usesAuxHolds: FILTER_DEFAULTS.usesAuxHolds,
        usesAuxHandHolds: FILTER_DEFAULTS.usesAuxHandHolds,
        sortBy: FILTER_DEFAULTS.sortBy,
        hideSent: FILTER_DEFAULTS.hideSent,
        hideAttempted: FILTER_DEFAULTS.hideAttempted,
      }),
      setSortBy: (sortBy) => set({ sortBy }),
      setHideSent: (hideSent) => set({ hideSent }),
      setHideAttempted: (hideAttempted) => set({ hideAttempted }),
      resetFilters: () => set({ ...FILTER_DEFAULTS }),
      loadFilters: (values) => set({ ...values }),
    }),
    { name: "kilter-filters" }
  )
);

// Grade lookup: difficulty number → display name
// Lower of a pair gets "-" suffix (e.g. 6a/V3 → "V3-", 6a+/V3 → "V3")
export const GRADES: { difficulty: number; name: string }[] = [
  { difficulty: 10, name: "V0-" },
  { difficulty: 11, name: "V0" },
  { difficulty: 12, name: "V0+" },
  { difficulty: 13, name: "V1-" },
  { difficulty: 14, name: "V1" },
  { difficulty: 15, name: "V2" },
  { difficulty: 16, name: "V3-" },
  { difficulty: 17, name: "V3" },
  { difficulty: 18, name: "V4-" },
  { difficulty: 19, name: "V4" },
  { difficulty: 20, name: "V5-" },
  { difficulty: 21, name: "V5" },
  { difficulty: 22, name: "V6" },
  { difficulty: 23, name: "V7" },
  { difficulty: 24, name: "V8-" },
  { difficulty: 25, name: "V8" },
  { difficulty: 26, name: "V9" },
  { difficulty: 27, name: "V10" },
  { difficulty: 28, name: "V11" },
  { difficulty: 29, name: "V12" },
  { difficulty: 30, name: "V13" },
  { difficulty: 31, name: "V14" },
  { difficulty: 32, name: "V15" },
  { difficulty: 33, name: "V16" },
];

export function difficultyToGrade(difficulty: number): string {
  const grade = GRADES.find((g) => g.difficulty === Math.round(difficulty));
  return grade?.name ?? `V?`;
}

export const ANGLES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70];

export const RECENCY_OPTIONS = [
  { label: "Off", value: 0 },
  { label: ">7d", value: 7 },
  { label: ">30d", value: 30 },
];

export const AUTO_DISCONNECT_OPTIONS = [
  { label: "Off", value: 0 },
  { label: "5s", value: 5 },
  { label: "10s", value: 10 },
  { label: "30s", value: 30 },
  { label: "60s", value: 60 },
];

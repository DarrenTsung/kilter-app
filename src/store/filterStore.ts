import { create } from "zustand";
import { persist } from "zustand/middleware";

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

  setGradeRange: (min: number, max: number) => void;
  setMinQuality: (val: number) => void;
  setMinAscents: (val: number) => void;
  setRecencyDays: (val: number) => void;
  setAngle: (val: number) => void;
  setUsesAuxHolds: (val: boolean) => void;
  setUsesAuxHandHolds: (val: boolean) => void;
  setAutoDisconnect: (val: number) => void;
  setCircuitUuid: (val: string | null) => void;
  resetFilters: () => void;
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
      setCircuitUuid: (circuitUuid) => set({ circuitUuid }),
      resetFilters: () => set({ ...FILTER_DEFAULTS }),
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
  { label: "No filter", value: 0 },
  { label: "7 days", value: 7 },
  { label: "30 days", value: 30 },
  { label: "90 days", value: 90 },
];

export const AUTO_DISCONNECT_OPTIONS = [
  { label: "Off", value: 0 },
  { label: "5s", value: 5 },
  { label: "10s", value: 10 },
  { label: "30s", value: 30 },
  { label: "60s", value: 60 },
];

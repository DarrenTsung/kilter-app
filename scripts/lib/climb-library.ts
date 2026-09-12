/**
 * Shared helpers for reading the bundled climb library (or a local app
 * backup). Both the snapshot generator and the hold-stats generator import
 * these so they always agree on which climbs count as "real" climbs.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export type Row = Record<string, unknown>;

export const LAYOUT_ID = 8;
export const AUX_SET_ID = 27;

/** Boulder grade indices used by the Kilter app (10 = 4a/V0 … 33 = 8c+/V16). */
export const MIN_GRADE = 10;
export const MAX_GRADE = 33;
export const GRADE_COUNT = MAX_GRADE - MIN_GRADE + 1;

export const OUTPUT_DIR = join(process.cwd(), "public", "data");
export const BUNDLED_LIBRARY = join(process.cwd(), "data", "climb-library.json");

/** Prefer the committed climb library, then the newest backup in ~/Downloads. */
export function defaultSourcePath(): string | null {
  if (existsSync(BUNDLED_LIBRARY)) return BUNDLED_LIBRARY;
  const dir = join(homedir(), "Downloads");
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((f) => /^kilter-backup-.*\.json$/.test(f))
    .map((f) => ({ p: join(dir, f), m: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  return files.length > 0 ? files[0].p : null;
}

export interface Library {
  path: string;
  rows: (table: string) => Row[];
}

export function loadLibrary(path: string): Library {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as {
    indexedDB?: Record<string, Row[]>;
  };
  const tables = parsed.indexedDB;
  if (!tables) throw new Error(`No indexedDB payload in ${path}`);
  return { path, rows: (t) => (Array.isArray(tables[t]) ? tables[t] : []) };
}

/** Full climbs that appear on the 7x10 homewall board (layout 8). */
export function filterClimbs(all: Row[]): Row[] {
  return all.filter((c) => {
    if (c.layout_id !== LAYOUT_ID || c.is_draft || !c.is_listed) return false;
    if ((c.edge_left as number) <= -44 || (c.edge_right as number) >= 44) return false;
    if ((c.edge_bottom as number) <= 24 || (c.edge_top as number) >= 144) return false;
    return true;
  });
}

/** Parse a frames string ("p123r14p456r15") into hold/role pairs. */
export function parseFrames(frames: unknown): { placementId: number; roleId: number }[] {
  const out: { placementId: number; roleId: number }[] = [];
  for (const part of String(frames ?? "").split("p")) {
    if (!part) continue;
    const [p, r] = part.split("r");
    const placementId = parseInt(p, 10);
    const roleId = parseInt(r, 10);
    if (Number.isFinite(placementId) && Number.isFinite(roleId)) {
      out.push({ placementId, roleId });
    }
  }
  return out;
}

/**
 * Grade the app shows for a stat row, as stored in the snapshot.
 * Kept unrounded (mirrors scripts/snapshot-from-backup.ts) — the UI rounds
 * with `difficultyToGrade` when rendering.
 */
export function rawDisplayDifficulty(stat: Row): number {
  return (
    (stat.benchmark_difficulty as number) || (stat.difficulty_average as number) || 0
  );
}

/** Grade bucket actually used for display / filtering (see difficultyToGrade). */
export function gradeBucket(stat: Row): number {
  return Math.round(rawDisplayDifficulty(stat));
}

/** True when `outputPath` exists and is at least as new as `sourcePath`. */
export function isUpToDate(outputPath: string, sourcePath: string): boolean {
  return (
    existsSync(outputPath) && statSync(outputPath).mtimeMs >= statSync(sourcePath).mtimeMs
  );
}

export function parseArgs(argv: string[]): { ifMissing: boolean; positional?: string } {
  return {
    ifMissing: argv.includes("--if-missing"),
    positional: argv.find((a) => !a.startsWith("--")),
  };
}

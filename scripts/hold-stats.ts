/**
 * Precompute per-hold usage statistics from the bundled climb library.
 *
 * For every angle we record, for each board placement (hold):
 *   - how many climbs at that angle use it (popularity)
 *   - the grade distribution of those climbs (24 buckets, grade 10..33)
 *
 * The editor uses this to show "this hold is used X% of the time and the
 * climbs it appears in are usually V3–V5" while you're picking a role.
 *
 * Usage:
 *   pnpm tsx scripts/hold-stats.ts                 # data/climb-library.json
 *   pnpm tsx scripts/hold-stats.ts --if-missing    # skip when up to date
 *   pnpm tsx scripts/hold-stats.ts path/to/backup.json
 */

import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import {
  GRADE_COUNT,
  LAYOUT_ID,
  MAX_GRADE,
  MIN_GRADE,
  OUTPUT_DIR,
  defaultSourcePath,
  filterClimbs,
  gradeBucket,
  isUpToDate,
  loadLibrary,
  parseArgs,
  parseFrames,
} from "./lib/climb-library";

const OUTPUT_PATH = join(OUTPUT_DIR, "hold-stats.json");

function main() {
  const { ifMissing, positional } = parseArgs(process.argv.slice(2));
  const sourcePath = positional ?? defaultSourcePath();

  if (!sourcePath) {
    console.warn("[hold-stats] No climb library or backup found; skipping.");
    return;
  }
  if (ifMissing && isUpToDate(OUTPUT_PATH, sourcePath)) {
    console.log("[hold-stats] hold-stats.json is up to date; skipping.");
    return;
  }

  console.log(`Reading climb data: ${sourcePath}`);
  const lib = loadLibrary(sourcePath);

  const climbs = filterClimbs(lib.rows("climbs"));
  const climbByUuid = new Map(climbs.map((c) => [c.uuid as string, c]));

  const stats = lib
    .rows("climb_stats")
    .map((s) => ({
      uuid: s.climb_uuid as string,
      angle: s.angle as number,
      grade: gradeBucket(s),
    }))
    .filter(
      (s) =>
        s.grade >= MIN_GRADE &&
        s.grade <= MAX_GRADE &&
        climbByUuid.has(s.uuid) &&
        Number.isFinite(s.angle)
    );

  interface AngleStats {
    climbs: number;
    gradeSum: number;
    holds: Record<string, number[]>;
  }

  const byAngle = new Map<number, AngleStats>();
  let holdSlots = 0;

  for (const s of stats) {
    let bucket = byAngle.get(s.angle);
    if (!bucket) {
      bucket = { climbs: 0, gradeSum: 0, holds: {} };
      byAngle.set(s.angle, bucket);
    }
    bucket.climbs++;
    bucket.gradeSum += s.grade;

    const climb = climbByUuid.get(s.uuid)!;
    for (const hold of parseFrames(climb.frames)) {
      const arr = (bucket.holds[hold.placementId] ??= new Array(GRADE_COUNT).fill(0));
      arr[s.grade - MIN_GRADE]++;
      holdSlots++;
    }
  }

  const angles: Record<string, unknown> = {};
  for (const angle of [...byAngle.keys()].sort((a, b) => a - b)) {
    const bucket = byAngle.get(angle)!;
    angles[String(angle)] = {
      climbs: bucket.climbs,
      mean_grade: Number((bucket.gradeSum / bucket.climbs).toFixed(2)),
      holds: bucket.holds,
    };
  }

  const out = {
    generated_at: new Date().toISOString(),
    layout: LAYOUT_ID,
    min_grade: MIN_GRADE,
    max_grade: MAX_GRADE,
    angles,
  };

  mkdirSync(OUTPUT_DIR, { recursive: true });
  const json = JSON.stringify(out);
  writeFileSync(OUTPUT_PATH, json);

  console.log(
    `\nWrote ${OUTPUT_PATH} (${(Buffer.byteLength(json) / 1024).toFixed(0)} KB)`
  );
  console.log(`  graded climbs: ${stats.length.toLocaleString()}  hold slots: ${holdSlots.toLocaleString()}`);
  for (const angle of [...byAngle.keys()].sort((a, b) => a - b)) {
    const bucket = byAngle.get(angle)!;
    console.log(
      `  ${angle}°: ${bucket.climbs.toLocaleString()} climbs, ${Object.keys(bucket.holds).length} holds used`
    );
  }
}

main();

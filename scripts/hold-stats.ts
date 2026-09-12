/**
 * Precompute per-hold usage statistics from the bundled climb library.
 *
 * For every angle we record, for each board placement (hold):
 *   - how many climbs at that angle use it (popularity)
 *   - the grade distribution of those climbs (24 buckets, grade 10..33)
 *   - how often it is used as a hand / foot / start / finish hold
 *
 * The editor uses this to show "this hold is used X% of the time and the
 * climbs it appears in are usually V3-V5" while you're picking a role.
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

/** Canonical role order stored in the roles arrays. */
const ROLE_ORDER = ["hand", "foot", "start", "finish"] as const;
type HoldRole = (typeof ROLE_ORDER)[number];

/**
 * Map a placement_roles name to a category. Mirrors the name matching in
 * src/components/InteractiveBoardView.tsx so the labels always agree.
 */
function roleCategory(name: string): HoldRole | null {
  const n = name.toLowerCase();
  if (n.includes("start")) return "start";
  if (n.includes("finish") || n.includes("top")) return "finish";
  if (n.includes("foot") || n.includes("feet")) return "foot";
  if (n.includes("hand") || n.includes("middle")) return "hand";
  return null;
}

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

  // Role id -> category, for the Kilter board product only.
  const roleById = new Map<number, HoldRole>();
  for (const r of lib.rows("placement_roles")) {
    if (r.product_id !== 7) continue;
    const cat = roleCategory(String(r.name ?? ""));
    if (cat) roleById.set(r.id as number, cat);
  }

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
    roles: Record<string, number[]>;
  }

  const byAngle = new Map<number, AngleStats>();
  let holdSlots = 0;

  for (const s of stats) {
    let bucket = byAngle.get(s.angle);
    if (!bucket) {
      bucket = { climbs: 0, gradeSum: 0, holds: {}, roles: {} };
      byAngle.set(s.angle, bucket);
    }
    bucket.climbs++;
    bucket.gradeSum += s.grade;

    const climb = climbByUuid.get(s.uuid)!;
    for (const hold of parseFrames(climb.frames)) {
      const arr = (bucket.holds[hold.placementId] ??= new Array(GRADE_COUNT).fill(0));
      arr[s.grade - MIN_GRADE]++;

      const cat = roleById.get(hold.roleId);
      if (cat) {
        const roles = (bucket.roles[hold.placementId] ??= new Array(ROLE_ORDER.length).fill(0));
        roles[ROLE_ORDER.indexOf(cat)]++;
      }

      holdSlots++;
    }
  }

  const angles: Record<string, unknown> = {};
  for (const angle of [...byAngle.keys()].sort((a, b) => a - b)) {
    const bucket = byAngle.get(angle)!;
    angles[String(angle)] = {
      climbs: bucket.climbs,
      mean_grade: Number((bucket.gradeSum / bucket.climbs).toFixed(2)),
      roles: ROLE_ORDER,
      holds: bucket.holds,
      hold_roles: bucket.roles,
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

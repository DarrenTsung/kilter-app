/**
 * Generate a static db-snapshot.json from the bundled climb library (or a
 * local app backup file).
 *
 * The normal generator (scripts/generate-snapshot.ts) pulls shared tables
 * from the Aurora API. When Aurora is unavailable, the repo's committed
 * climb library (data/climb-library.json) — or a previously exported app
 * backup — still contains every shared table, so we can rebuild the
 * snapshot from it without network access.
 *
 * Usage:
 *   pnpm tsx scripts/snapshot-from-backup.ts                 # data/climb-library.json
 *   pnpm tsx scripts/snapshot-from-backup.ts --if-missing    # skip if up to date
 *   pnpm tsx scripts/snapshot-from-backup.ts path/to/backup.json
 */

import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import {
  AUX_SET_ID,
  LAYOUT_ID,
  OUTPUT_DIR,
  defaultSourcePath,
  filterClimbs,
  isUpToDate,
  loadLibrary,
  parseArgs,
  rawDisplayDifficulty,
  type Row,
} from "./lib/climb-library";

const SHARED_TABLES = [
  "climbs",
  "climb_stats",
  "beta_links",
  "placements",
  "holes",
  "leds",
  "placement_roles",
  "difficulty_grades",
  "product_sizes_layouts_sets",
] as const;

const OUTPUT_PATH = join(OUTPUT_DIR, "db-snapshot.json");

function main() {
  const { ifMissing, positional } = parseArgs(process.argv.slice(2));
  const sourcePath = positional ?? defaultSourcePath();

  if (!sourcePath) {
    console.warn("[snapshot] No climb library or backup found; skipping.");
    return;
  }
  if (ifMissing && isUpToDate(OUTPUT_PATH, sourcePath)) {
    console.log("[snapshot] db-snapshot.json is up to date; skipping.");
    return;
  }

  console.log(`Reading climb data: ${sourcePath}`);
  const lib = loadLibrary(sourcePath);
  const rows = lib.rows;

  // ── climbs: layout 8, listed, non-draft, within 7x10 bounds ──
  const allClimbs = rows("climbs");
  const climbs = filterClimbs(allClimbs);
  const validUuids = new Set(climbs.map((c) => c.uuid as string));
  console.log(`  climbs: ${allClimbs.length} → ${climbs.length}`);

  // ── climbs: recompute aux-hold flags ──
  const placements = rows("placements");
  const auxIds = new Set(
    placements
      .filter((p) => p.layout_id === LAYOUT_ID && p.set_id === AUX_SET_ID)
      .map((p) => p.id as number)
  );
  const footRole = rows("placement_roles").find(
    (r) =>
      r.product_id === 7 &&
      ["foot", "feet"].includes(String(r.name).toLowerCase())
  );
  const footRoleId = footRole?.id;
  for (const climb of climbs) {
    const frames = String(climb.frames ?? "");
    const holds = frames
      .split("p")
      .filter(Boolean)
      .map((part) => {
        const [p, r] = part.split("r");
        return { placementId: parseInt(p, 10), roleId: parseInt(r, 10) };
      });
    climb.has_aux_hold = holds.some((h) => auxIds.has(h.placementId));
    climb.has_aux_hand_hold = holds.some(
      (h) => auxIds.has(h.placementId) && h.roleId !== footRoleId
    );
  }

  // ── climb_stats: keep valid difficulty + only surviving climbs ──
  const stats = rows("climb_stats")
    .map((s): Row => ({ ...s, display_difficulty: rawDisplayDifficulty(s) }))
    .filter((s) => s.display_difficulty && validUuids.has(s.climb_uuid as string));
  console.log(`  climb_stats: ${rows("climb_stats").length} → ${stats.length}`);

  // ── beta_links: listed only ──
  const beta = rows("beta_links")
    .map((b) => ({ ...b, is_listed: b.is_listed ? 1 : 0 }))
    .filter((b) => b.is_listed === 1);

  // ── sync cursors ──
  const syncDates: Record<string, string> = {};
  for (const s of rows("sync_state")) {
    if (s.table_name && s.last_synchronized_at) {
      syncDates[s.table_name as string] = s.last_synchronized_at as string;
    }
  }

  const out = {
    meta: { generated_at: new Date().toISOString(), sync_dates: syncDates },
    tables: {
      climbs,
      climb_stats: stats,
      beta_links: beta,
      placements,
      holes: rows("holes"),
      leds: rows("leds"),
      placement_roles: rows("placement_roles"),
      difficulty_grades: rows("difficulty_grades"),
      product_sizes_layouts_sets: rows("product_sizes_layouts_sets"),
    },
  };

  mkdirSync(OUTPUT_DIR, { recursive: true });
  const json = JSON.stringify(out);
  writeFileSync(OUTPUT_PATH, json);

  console.log(`\nWrote ${OUTPUT_PATH} (${(Buffer.byteLength(json) / 1024 / 1024).toFixed(1)} MB)`);
  for (const t of SHARED_TABLES) {
    console.log(`  ${t}: ${out.tables[t].length.toLocaleString()}`);
  }
}

main();

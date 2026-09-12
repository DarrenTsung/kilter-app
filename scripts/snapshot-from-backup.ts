/**
 * Generate a static db-snapshot.json from a local app backup file.
 *
 * The normal generator (scripts/generate-snapshot.ts) pulls shared tables
 * from the Aurora API. When Aurora is unavailable, a previously exported
 * backup still contains every shared table, so we can rebuild the snapshot
 * from it without any network access.
 *
 * Usage:
 *   pnpm tsx scripts/snapshot-from-backup.ts path/to/kilter-backup.json
 *   pnpm tsx scripts/snapshot-from-backup.ts            # newest in ~/Downloads
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";

type Row = Record<string, unknown>;

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

const LAYOUT_ID = 8;
const AUX_SET_ID = 27;

function newestBackup(): string {
  const dir = join(homedir(), "Downloads");
  const files = readdirSync(dir)
    .filter((f) => /^kilter-backup-.*\.json$/.test(f))
    .map((f) => ({ f, p: join(dir, f), m: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  if (files.length === 0) throw new Error(`No kilter-backup-*.json found in ${dir}`);
  return files[0].p;
}

function main() {
  const backupPath = process.argv[2] ?? newestBackup();
  console.log(`Reading backup: ${backupPath}`);

  const backup = JSON.parse(readFileSync(backupPath, "utf8")) as {
    indexedDB?: Record<string, Row[]>;
  };
  const tables = backup.indexedDB;
  if (!tables) throw new Error("Backup has no indexedDB payload");

  const rows = (t: string): Row[] => (Array.isArray(tables[t]) ? tables[t] : []);

  // ── climbs: layout 8, listed, non-draft, within 7x10 bounds ──
  const allClimbs = rows("climbs");
  const climbs = allClimbs.filter((c) => {
    if (c.layout_id !== LAYOUT_ID || c.is_draft || !c.is_listed) return false;
    if ((c.edge_left as number) <= -44 || (c.edge_right as number) >= 44) return false;
    if ((c.edge_bottom as number) <= 24 || (c.edge_top as number) >= 144) return false;
    return true;
  });
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
    .map((s): Row => {
      const display = (s.benchmark_difficulty as number) || (s.difficulty_average as number);
      return { ...s, display_difficulty: display };
    })
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

  const outputDir = join(process.cwd(), "public", "data");
  mkdirSync(outputDir, { recursive: true });
  const outputPath = join(outputDir, "db-snapshot.json");
  const json = JSON.stringify(out);
  writeFileSync(outputPath, json);

  console.log(`\nWrote ${outputPath} (${(Buffer.byteLength(json) / 1024 / 1024).toFixed(1)} MB)`);
  for (const t of SHARED_TABLES) {
    console.log(`  ${t}: ${out.tables[t].length.toLocaleString()}`);
  }
}

main();

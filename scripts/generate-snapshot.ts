/**
 * Generate a static snapshot of shared tables from the Aurora API.
 *
 * Usage:
 *   pnpm generate-snapshot --token=YOUR_TOKEN
 *
 * The token comes from logging into kilterboardapp.com (inspect cookies → `token`).
 * Aurora requires auth even for shared/public data — the /sync endpoint returns 404
 * without a valid token cookie.
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

const AURORA_HOST = "https://kilterboardapp.com";
const AURORA_USER_AGENT = "Kilter%20Board/202 CFNetwork/1568.100.1 Darwin/24.0.0";
const BASE_SYNC_DATE = "1970-01-01 00:00:00.000000";
const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 3000, 10000];

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

// All tables the APK sends to /sync — must include ALL to avoid the API
// re-sending ignored tables from epoch on every subsequent user sync.
const ALL_APK_SHARED_TABLES = [
  "products", "product_sizes", "holes", "leds", "products_angles",
  "layouts", "product_sizes_layouts_sets", "placements", "sets",
  "placement_roles", "climbs", "climb_stats", "beta_links",
  "attempts", "kits",
] as const;

const ALL_APK_USER_TABLES = [
  "users", "walls", "draft_climbs", "ascents", "bids", "tags", "circuits",
] as const;

// Difficulty grades are embedded in the APK, not synced via API
const DIFFICULTY_GRADES = [
  { difficulty: 10, boulder_name: "4a/V0", route_name: "5a", is_listed: 1 },
  { difficulty: 11, boulder_name: "4b/V0", route_name: "5b", is_listed: 1 },
  { difficulty: 12, boulder_name: "4c/V0", route_name: "5c", is_listed: 1 },
  { difficulty: 13, boulder_name: "5a/V1", route_name: "5d", is_listed: 1 },
  { difficulty: 14, boulder_name: "5b/V1", route_name: "5e", is_listed: 1 },
  { difficulty: 15, boulder_name: "5c/V2", route_name: "5f", is_listed: 1 },
  { difficulty: 16, boulder_name: "6a/V3", route_name: "6a", is_listed: 1 },
  { difficulty: 17, boulder_name: "6a+/V3", route_name: "6b", is_listed: 1 },
  { difficulty: 18, boulder_name: "6b/V4", route_name: "6c", is_listed: 1 },
  { difficulty: 19, boulder_name: "6b+/V4", route_name: "6d", is_listed: 1 },
  { difficulty: 20, boulder_name: "6c/V5", route_name: "7a", is_listed: 1 },
  { difficulty: 21, boulder_name: "6c+/V5", route_name: "7b", is_listed: 1 },
  { difficulty: 22, boulder_name: "7a/V6", route_name: "7c", is_listed: 1 },
  { difficulty: 23, boulder_name: "7a+/V7", route_name: "7d", is_listed: 1 },
  { difficulty: 24, boulder_name: "7b/V8", route_name: "8a", is_listed: 1 },
  { difficulty: 25, boulder_name: "7b+/V8", route_name: "8b", is_listed: 1 },
  { difficulty: 26, boulder_name: "7c/V9", route_name: "8c", is_listed: 1 },
  { difficulty: 27, boulder_name: "7c+/V10", route_name: "8d", is_listed: 1 },
  { difficulty: 28, boulder_name: "8a/V11", route_name: "9a", is_listed: 1 },
  { difficulty: 29, boulder_name: "8a+/V12", route_name: "9b", is_listed: 1 },
  { difficulty: 30, boulder_name: "8b/V13", route_name: "9c", is_listed: 1 },
  { difficulty: 31, boulder_name: "8b+/V14", route_name: "9d", is_listed: 1 },
  { difficulty: 32, boulder_name: "8c/V15", route_name: "10a", is_listed: 1 },
  { difficulty: 33, boulder_name: "8c+/V16", route_name: "10b", is_listed: 1 },
];

interface FrameHold {
  placementId: number;
  roleId: number;
}

function parseFrames(frames: string): FrameHold[] {
  if (!frames) return [];
  const holds: FrameHold[] = [];
  const parts = frames.split("p").filter(Boolean);
  for (const part of parts) {
    const [placementStr, roleStr] = part.split("r");
    if (placementStr && roleStr) {
      holds.push({
        placementId: parseInt(placementStr, 10),
        roleId: parseInt(roleStr, 10),
      });
    }
  }
  return holds;
}

async function fetchWithRetry(
  url: string,
  init: RequestInit
): Promise<Response> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, init);
      if (response.ok) return response;
      if (response.status === 401 || response.status === 403) {
        throw new Error(`Auth failed: ${response.status}. Is your token valid?`);
      }
      if (attempt < MAX_RETRIES) {
        console.log(`  Retry ${attempt + 1}/${MAX_RETRIES} after ${response.status}...`);
        await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
        continue;
      }
      throw new Error(`Failed after ${MAX_RETRIES + 1} attempts: ${response.status}`);
    } catch (err) {
      if (err instanceof TypeError && attempt < MAX_RETRIES) {
        console.log(`  Network error, retry ${attempt + 1}/${MAX_RETRIES}...`);
        await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
        continue;
      }
      throw err;
    }
  }
  throw new Error("Exhausted retries");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

async function loginAndGetToken(): Promise<string> {
  const credFile = join(process.cwd(), ".kilterpassword");
  if (!existsSync(credFile)) {
    console.error("Missing .kilterpassword file.");
    console.error("Create it with: username:password");
    process.exit(1);
  }
  const [username, password] = readFileSync(credFile, "utf-8").trim().split(":");
  console.log(`Logging in as ${username}...`);

  const response = await fetch(`${AURORA_HOST}/sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": AURORA_USER_AGENT,
    },
    body: JSON.stringify({ username, password, tou: "accepted", pp: "accepted", ua: "app" }),
  });

  if (!response.ok) {
    throw new Error(`Login failed: ${response.status}`);
  }
  const data = await response.json();
  return data.session.token;
}

async function main() {
  // Get token: --token=X flag or auto-login from .kilterpassword
  const tokenArg = process.argv.find((a) => a.startsWith("--token="));
  const token = tokenArg
    ? tokenArg.split("=").slice(1).join("=")
    : await loginAndGetToken();

  console.log("Syncing shared tables from Aurora API...\n");

  // Accumulate all rows per table
  const allRows: Record<string, Row[]> = {};
  for (const t of SHARED_TABLES) allRows[t] = [];

  // Track sync dates — capture ALL table sync dates (not just the ones we store)
  // so the snapshot has cursors for every APK table
  const syncDates: Record<string, string> = {};
  const payload: Record<string, string> = {};
  for (const t of ALL_APK_SHARED_TABLES) payload[t] = BASE_SYNC_DATE;
  for (const t of ALL_APK_USER_TABLES) payload[t] = BASE_SYNC_DATE;

  let page = 0;
  let complete = false;
  while (!complete) {
    const formBody = Object.entries(payload)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");

    const response = await fetchWithRetry(`${AURORA_HOST}/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": AURORA_USER_AGENT,
        Cookie: `token=${token}; appcheck=`,
      },
      body: formBody,
    });

    const data = await response.json();
    complete = data._complete ?? false;

    for (const table of SHARED_TABLES) {
      const rows = data[table];
      if (rows && rows.length > 0) {
        allRows[table].push(...rows);
      }
    }

    // Update sync dates from response — capture ALL tables (shared + user)
    for (const syncList of [data.shared_syncs ?? [], data.user_syncs ?? []]) {
      for (const sync of syncList) {
        if (sync.table_name in payload && sync.last_synchronized_at) {
          payload[sync.table_name] = sync.last_synchronized_at;
          syncDates[sync.table_name] = sync.last_synchronized_at;
        }
      }
    }

    page++;
    const totalRows = Object.values(allRows).reduce((a, b) => a + b.length, 0);
    process.stdout.write(`\r  Page ${page} · ${totalRows.toLocaleString()} rows`);

    if (page > 500) {
      console.log("\n  Safety limit reached (500 pages)");
      break;
    }
  }
  console.log("\n");

  // ── Post-processing ──

  // 1. climb_stats: compute display_difficulty, remove rows without valid difficulty
  console.log("Processing climb_stats...");
  const processedStats: Row[] = [];
  for (const row of allRows.climb_stats) {
    // Use || not ?? — benchmark_difficulty of 0 should fall through
    const displayDiff = row.benchmark_difficulty || row.difficulty_average;
    if (!displayDiff) continue;
    processedStats.push({ ...row, display_difficulty: displayDiff });
  }
  allRows.climb_stats = processedStats;
  console.log(`  ${allRows.climb_stats.length.toLocaleString()} climb_stats with valid difficulty`);

  // 2. beta_links: normalize is_listed, filter to listed only
  console.log("Processing beta_links...");
  allRows.beta_links = allRows.beta_links
    .map((row) => ({ ...row, is_listed: row.is_listed ? 1 : 0 }))
    .filter((row) => row.is_listed === 1);
  console.log(`  ${allRows.beta_links.length.toLocaleString()} listed beta_links`);

  // 3. Prune climbs: keep only layout_id=8, listed, non-draft, within 7x10 bounds
  console.log("Pruning climbs...");
  const beforeCount = allRows.climbs.length;
  allRows.climbs = allRows.climbs.filter((c) => {
    if (c.layout_id !== 8 || c.is_draft || !c.is_listed) return false;
    if (c.edge_left <= -44 || c.edge_right >= 44 || c.edge_bottom <= 24 || c.edge_top >= 144) return false;
    return true;
  });
  console.log(`  ${beforeCount.toLocaleString()} → ${allRows.climbs.length.toLocaleString()} climbs (pruned ${(beforeCount - allRows.climbs.length).toLocaleString()})`);

  // 4. Delete climb_stats for pruned climbs
  const validClimbUuids = new Set(allRows.climbs.map((c) => c.uuid));
  const statsBefore = allRows.climb_stats.length;
  allRows.climb_stats = allRows.climb_stats.filter((s) => validClimbUuids.has(s.climb_uuid));
  console.log(`  Removed ${(statsBefore - allRows.climb_stats.length).toLocaleString()} orphaned climb_stats`);

  // 5. Compute has_aux_hold / has_aux_hand_hold
  console.log("Computing aux hold flags...");
  const auxIds = new Set(
    allRows.placements
      .filter((p) => p.layout_id === 8 && p.set_id === 27)
      .map((p) => p.id)
  );
  const roles = allRows.placement_roles;
  const footRole = roles.find(
    (r) => r.product_id === 7 && (r.name.toLowerCase() === "foot" || r.name.toLowerCase() === "feet")
  );
  const footRoleId = footRole?.id;
  console.log(`  ${auxIds.size} aux placements, foot role ID: ${footRoleId}`);

  let auxCount = 0;
  for (const climb of allRows.climbs) {
    const frames = parseFrames(climb.frames);
    const hasAux = frames.some((f) => auxIds.has(f.placementId));
    const hasAuxHand = frames.some(
      (f) => auxIds.has(f.placementId) && f.roleId !== footRoleId
    );
    climb.has_aux_hold = hasAux;
    climb.has_aux_hand_hold = hasAuxHand;
    if (hasAux) auxCount++;
  }
  console.log(`  ${auxCount.toLocaleString()} climbs use aux holds`);

  // 6. Seed difficulty_grades (these are hardcoded in the APK)
  if (allRows.difficulty_grades.length === 0) {
    allRows.difficulty_grades = DIFFICULTY_GRADES;
    console.log("Seeded difficulty_grades from hardcoded list");
  }

  // ── Write snapshot ──

  const outputDir = join(process.cwd(), "public", "data");
  mkdirSync(outputDir, { recursive: true });

  const snapshot = {
    meta: {
      generated_at: new Date().toISOString(),
      sync_dates: syncDates,
    },
    tables: allRows,
  };

  const outputPath = join(outputDir, "db-snapshot.json");
  const json = JSON.stringify(snapshot);
  writeFileSync(outputPath, json);

  const sizeMB = (Buffer.byteLength(json) / 1024 / 1024).toFixed(1);
  console.log(`\nWrote ${outputPath}`);
  console.log(`  Size: ${sizeMB} MB`);
  for (const [table, rows] of Object.entries(allRows)) {
    if (rows.length > 0) {
      console.log(`  ${table}: ${rows.length.toLocaleString()} rows`);
    }
  }
}

main().catch((err) => {
  console.error("\nFailed:", err.message);
  process.exit(1);
});

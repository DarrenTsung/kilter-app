import { getDB, type KilterDB } from "./index";
import { parseFrames } from "../utils/frames";
import { invalidateClimbCache, invalidateCircuitCache, invalidateBlockCache, invalidateBetaClimbCache } from "./queries";

const API_BASE = "/api/aurora";
const BASE_SYNC_DATE = "1970-01-01 00:00:00.000000";
const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 3000, 10000]; // ms

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  signal?: AbortSignal
): Promise<Response> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (signal?.aborted) throw new Error("Sync cancelled");
    try {
      const response = await fetch(url, { ...init, signal });
      if (response.ok) return response;
      // Don't retry on auth errors
      if (response.status === 401 || response.status === 403) {
        throw new Error(`Sync failed: ${response.status}`);
      }
      // Retry on server errors or rate limits
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
        continue;
      }
      throw new Error(`Sync failed after ${MAX_RETRIES + 1} attempts: ${response.status}`);
    } catch (err) {
      if (signal?.aborted) throw new Error("Sync cancelled");
      if (err instanceof TypeError && attempt < MAX_RETRIES) {
        // Network error — retry
        await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
        continue;
      }
      throw err;
    }
  }
  throw new Error("Sync failed: exhausted retries");
}

// Tables we sync (shared/public)
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

// User-specific tables (require auth)
// Note: circuits_climbs is NOT a sync table — climb associations come nested
// inside circuit objects and are extracted during upsert.
const USER_TABLES = ["ascents", "circuits", "tags"] as const;

type SharedTable = (typeof SHARED_TABLES)[number];
type UserTable = (typeof USER_TABLES)[number];
type SyncTable = SharedTable | UserTable;

export interface SyncProgress {
  stage: string;
  detail?: string;
}

export async function syncAll(
  token: string | null,
  userId: number | null,
  onProgress?: (progress: SyncProgress) => void,
  signal?: AbortSignal
): Promise<Record<string, number>> {
  const db = await getDB();
  const totalCounts: Record<string, number> = {};

  // Build shared table sync dates
  const sharedPayload: Record<string, string> = {};
  for (const table of SHARED_TABLES) {
    const syncState = await db.get("sync_state", table);
    sharedPayload[table] = syncState?.last_synchronized_at ?? BASE_SYNC_DATE;
  }

  // Sync shared tables (paginated)
  let page = 0;
  let complete = false;
  while (!complete) {
    const formBody = Object.entries(sharedPayload)
      .map(
        ([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`
      )
      .join("&");

    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
    };
    if (token) {
      headers["X-Aurora-Token"] = token;
    }

    const response = await fetchWithRetry(
      `${API_BASE}/sync`,
      { method: "POST", headers, body: formBody },
      signal
    );

    const data = await response.json();
    complete = data._complete ?? false;

    // Process each table in the response
    for (const table of SHARED_TABLES) {
      const rows = data[table];
      if (rows && rows.length > 0) {
        await upsertRows(db, table, rows);
        totalCounts[table] = (totalCounts[table] ?? 0) + rows.length;
      }
    }

    // Update sync dates from response
    const sharedSyncs = data.shared_syncs ?? [];
    for (const sync of sharedSyncs) {
      if (sync.table_name in sharedPayload && sync.last_synchronized_at) {
        sharedPayload[sync.table_name] = sync.last_synchronized_at;
        await db.put("sync_state", {
          table_name: sync.table_name,
          last_synchronized_at: sync.last_synchronized_at,
        });
      }
    }

    page++;
    const total = Object.values(totalCounts).reduce((a, b) => a + b, 0);
    onProgress?.({
      stage: "Syncing climbs",
      detail: `page ${page} · ${total.toLocaleString()} rows`,
    });

    if (page > 500) break; // Safety limit — fresh sync needs many pages
  }

  // Sync user tables if logged in (paginated like shared tables)
  if (token && userId) {
    const userPayload: Record<string, string> = {};

    // If circuits_climbs is empty, force re-sync of circuits to re-extract
    // the nested climb associations
    const ccCount = await db.count("circuits_climbs");
    if (ccCount === 0) {
      await db.delete("sync_state", `user-${userId}-circuits`);
    }
    // Clean up old circuits_climbs sync state (no longer a sync table)
    await db.delete("sync_state", `user-${userId}-circuits_climbs`);

    for (const table of USER_TABLES) {
      const key = `user-${userId}-${table}`;
      const storeCount = await db.count(table);
      if (storeCount === 0) {
        await db.delete("sync_state", key);
      }
      const syncState = await db.get("sync_state", key);
      userPayload[table] = syncState?.last_synchronized_at ?? BASE_SYNC_DATE;
    }

    let userPage = 0;
    let userComplete = false;
    while (!userComplete) {
      const formBody = Object.entries(userPayload)
        .map(
          ([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`
        )
        .join("&");

      const response = await fetchWithRetry(
        `${API_BASE}/sync`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "X-Aurora-Token": token,
          },
          body: formBody,
        },
        signal
      );

      const data = await response.json();
      userComplete = data._complete ?? true;

      for (const table of USER_TABLES) {
        const rows = data[table];
        if (rows && rows.length > 0) {
          await upsertRows(db, table, rows);
          totalCounts[table] = (totalCounts[table] ?? 0) + rows.length;
        }
      }

      // Update user sync dates for next page
      const userSyncs = data.user_syncs ?? [];
      for (const sync of userSyncs) {
        if (sync.table_name && sync.last_synchronized_at) {
          userPayload[sync.table_name] = sync.last_synchronized_at;
          const key = `user-${userId}-${sync.table_name}`;
          await db.put("sync_state", {
            table_name: key,
            last_synchronized_at: sync.last_synchronized_at,
          });
        }
      }

      userPage++;
      onProgress?.({
        stage: "Syncing user data",
        detail: `ascents, circuits · page ${userPage}`,
      });

      if (userPage > 100) break; // Safety limit
    }
  }

  onProgress?.({ stage: "Seeding grades" });
  await seedDifficultyGrades(db);

  onProgress?.({ stage: "Pruning non-matching climbs" });
  await pruneNonMatchingClimbs(db);

  onProgress?.({ stage: "Computing aux hold flags" });
  await computeAuxHoldFlags(db);

  // Invalidate query caches since data changed
  invalidateClimbCache();
  invalidateCircuitCache();
  invalidateBlockCache();
  invalidateBetaClimbCache();

  onProgress?.({ stage: "Done" });

  return totalCounts;
}

async function upsertRows(
  db: Awaited<ReturnType<typeof getDB>>,
  table: SyncTable,
  rows: Record<string, unknown>[]
) {
  // Circuits: extract nested climb associations into circuits_climbs,
  // then strip the `climbs` property so it doesn't break the circuits put.
  if (table === "circuits") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ccTx = db.transaction("circuits_climbs" as any, "readwrite");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ccStore = ccTx.objectStore("circuits_climbs" as any);
    let ccCount = 0;
    for (const row of rows) {
      const climbs = row.climbs as Array<{ uuid: string; position: number }> | undefined;
      if (climbs && Array.isArray(climbs)) {
        for (const c of climbs) {
          await ccStore.put({
            circuit_uuid: row.uuid,
            climb_uuid: c.uuid,
            position: c.position,
          } as never);
          ccCount++;
        }
      }
      delete row.climbs;
    }
    await ccTx.done;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tx = db.transaction(table as any, "readwrite");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const store = tx.objectStore(table as any);

  for (const row of rows) {
    // beta_links: remove unlisted entries, normalize is_listed to number
    if (table === "beta_links") {
      row.is_listed = row.is_listed ? 1 : 0;
      if (!row.is_listed) {
        try {
          await store.delete([
            row.climb_uuid as string,
            row.link as string,
          ] as never);
        } catch {
          // Key may not exist
        }
        continue;
      }
    }
    // climb_stats: handle deletions (no display_difficulty means delete)
    // Use || not ?? — benchmark_difficulty of 0 should fall through to difficulty_average
    if (table === "climb_stats") {
      const displayDiff =
        row.benchmark_difficulty || row.difficulty_average;
      if (!displayDiff) {
        try {
          await store.delete([
            row.climb_uuid as string,
            row.angle as number,
          ] as never);
        } catch {
          // Key may not exist
        }
        continue;
      }
      row.display_difficulty = displayDiff;
    }
    await store.put(row as never);
  }

  await tx.done;
}

/**
 * Remove climbs (and their stats) that don't match the 7x10 homewall board.
 * This reduces DB size and speeds up filter queries.
 */
async function pruneNonMatchingClimbs(
  db: Awaited<ReturnType<typeof getDB>>
) {
  const allClimbs = await db.getAll("climbs");
  const toDelete: string[] = [];

  for (const c of allClimbs) {
    if (c.layout_id !== 8 || c.is_draft || !c.is_listed) {
      toDelete.push(c.uuid);
      continue;
    }
    // Outside 7x10 board bounds
    if (c.edge_left <= -44 || c.edge_right >= 44 || c.edge_bottom <= 24 || c.edge_top >= 144) {
      toDelete.push(c.uuid);
    }
  }

  if (toDelete.length === 0) return;

  // Delete climbs
  const climbTx = db.transaction("climbs", "readwrite");
  for (const uuid of toDelete) {
    await climbTx.objectStore("climbs").delete(uuid);
  }
  await climbTx.done;

  // Delete associated climb_stats
  const deleteSet = new Set(toDelete);
  const allStats = await db.getAll("climb_stats");
  const statsTx = db.transaction("climb_stats", "readwrite");
  for (const s of allStats) {
    if (deleteSet.has(s.climb_uuid)) {
      await statsTx.objectStore("climb_stats").delete([s.climb_uuid, s.angle]);
    }
  }
  await statsTx.done;

  console.log(`[sync] pruned ${toDelete.length} non-matching climbs`);
}

async function computeAuxHoldFlags(
  db: Awaited<ReturnType<typeof getDB>>
) {
  // Get aux placement IDs for homewall (layout_id=8, set_id=27)
  const allPlacements = await db.getAllFromIndex(
    "placements",
    "by-layout",
    8
  );
  const auxIds = new Set(
    allPlacements.filter((p) => p.set_id === 27).map((p) => p.id)
  );

  if (auxIds.size === 0) return;

  // Get foot role ID for homewall (product_id=7)
  const roles = await db.getAll("placement_roles");
  const footRole = roles.find(
    (r) =>
      r.product_id === 7 &&
      (r.name.toLowerCase() === "foot" || r.name.toLowerCase() === "feet")
  );
  const footRoleId = footRole?.id; // Should be 45

  // Process climbs for layout 8
  const climbs = await db.getAllFromIndex("climbs", "by-layout", 8);
  const tx = db.transaction("climbs", "readwrite");

  for (const climb of climbs) {
    const frames = parseFrames(climb.frames);
    const hasAux = frames.some((f) => auxIds.has(f.placementId));
    const hasAuxHand = frames.some(
      (f) => auxIds.has(f.placementId) && f.roleId !== footRoleId
    );

    climb.has_aux_hold = hasAux;
    climb.has_aux_hand_hold = hasAuxHand;
    await tx.objectStore("climbs").put(climb);
  }

  await tx.done;
}

// Difficulty grades are embedded in the APK, not synced via the API.
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

async function seedDifficultyGrades(
  db: Awaited<ReturnType<typeof getDB>>
) {
  const count = await db.count("difficulty_grades");
  if (count > 0) return;

  const tx = db.transaction("difficulty_grades", "readwrite");
  for (const grade of DIFFICULTY_GRADES) {
    await tx.objectStore("difficulty_grades").put(grade);
  }
  await tx.done;
}

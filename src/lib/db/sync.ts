import { getDB, type KilterDB } from "./index";
import { parseFrames } from "../utils/frames";

const API_BASE = "/api/aurora";
const BASE_SYNC_DATE = "1970-01-01 00:00:00.000000";

// Tables we sync (shared/public)
const SHARED_TABLES = [
  "climbs",
  "climb_stats",
  "placements",
  "holes",
  "leds",
  "placement_roles",
  "difficulty_grades",
  "product_sizes_layouts_sets",
] as const;

// User-specific tables (require auth)
const USER_TABLES = ["ascents"] as const;

type SharedTable = (typeof SHARED_TABLES)[number];
type UserTable = (typeof USER_TABLES)[number];
type SyncTable = SharedTable | UserTable;

export interface SyncProgress {
  phase: "shared" | "user";
  page: number;
  complete: boolean;
  tableCounts: Record<string, number>;
}

export async function syncAll(
  token: string | null,
  userId: number | null,
  onProgress?: (progress: SyncProgress) => void
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

    const response = await fetch(`${API_BASE}/sync`, {
      method: "POST",
      headers,
      body: formBody,
    });

    if (!response.ok) {
      throw new Error(`Sync failed: ${response.status}`);
    }

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
    onProgress?.({
      phase: "shared",
      page,
      complete,
      tableCounts: { ...totalCounts },
    });

    if (page > 100) break; // Safety limit
  }

  // Sync user tables if logged in
  if (token && userId) {
    const userPayload: Record<string, string> = {};
    for (const table of USER_TABLES) {
      const key = `user-${userId}-${table}`;
      const syncState = await db.get("sync_state", key);
      userPayload[table] = syncState?.last_synchronized_at ?? BASE_SYNC_DATE;
    }

    const formBody = Object.entries(userPayload)
      .map(
        ([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`
      )
      .join("&");

    const response = await fetch(`${API_BASE}/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Aurora-Token": token,
      },
      body: formBody,
    });

    if (response.ok) {
      const data = await response.json();

      for (const table of USER_TABLES) {
        const rows = data[table];
        if (rows && rows.length > 0) {
          await upsertRows(db, table, rows);
          totalCounts[table] = (totalCounts[table] ?? 0) + rows.length;
        }
      }

      // Update user sync dates
      const userSyncs = data.user_syncs ?? [];
      for (const sync of userSyncs) {
        if (sync.table_name && sync.last_synchronized_at) {
          const key = `user-${userId}-${sync.table_name}`;
          await db.put("sync_state", {
            table_name: key,
            last_synchronized_at: sync.last_synchronized_at,
          });
        }
      }
    }

    onProgress?.({
      phase: "user",
      page: 1,
      complete: true,
      tableCounts: { ...totalCounts },
    });
  }

  // Pre-compute auxiliary hold flags after sync
  await computeAuxHoldFlags(db);

  return totalCounts;
}

async function upsertRows(
  db: Awaited<ReturnType<typeof getDB>>,
  table: SyncTable,
  rows: Record<string, unknown>[]
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tx = db.transaction(table as any, "readwrite");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const store = tx.objectStore(table as any);

  for (const row of rows) {
    // climb_stats: handle deletions (no display_difficulty means delete)
    if (table === "climb_stats") {
      const displayDiff =
        row.benchmark_difficulty ?? row.difficulty_average;
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

  // Get foot role ID for layout 8
  const roles = await db.getAll("placement_roles");
  const footRole = roles.find(
    (r) => r.name === "FEET" || r.name === "feet" || r.name === "Feet"
  );
  const footRoleId = footRole?.id;

  // Process climbs for layout 8
  const climbs = await db.getAllFromIndex("climbs", "by-layout", 8);
  const tx = db.transaction("climbs", "readwrite");

  for (const climb of climbs) {
    const frames = parseFrames(climb.frames);
    const hasAux = frames.some((f) => auxIds.has(f.placementId));
    const hasAuxHand = frames.some(
      (f) => auxIds.has(f.placementId) && f.roleId !== footRoleId
    );

    if (climb.has_aux_hold !== hasAux || climb.has_aux_hand_hold !== hasAuxHand) {
      climb.has_aux_hold = hasAux;
      climb.has_aux_hand_hold = hasAuxHand;
      await tx.objectStore("climbs").put(climb);
    }
  }

  await tx.done;
}

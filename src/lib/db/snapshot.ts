import { getDB } from "./index";
import {
  invalidateClimbCache,
  invalidateCircuitCache,
  invalidateBlockCache,
  invalidateBetaClimbCache,
} from "./queries";

interface SnapshotMeta {
  generated_at: string;
  sync_dates: Record<string, string>;
}

interface SnapshotData {
  meta: SnapshotMeta;
  tables: Record<string, Record<string, unknown>[]>;
}

// Tables in the snapshot that map to IndexedDB stores
const SNAPSHOT_TABLES = [
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

export interface SnapshotProgress {
  pct: number;
  stage: string;
}

/**
 * Load the pre-built snapshot into IndexedDB.
 * Returns true if snapshot was loaded, false if DB already had data.
 */
export async function loadSnapshot(
  onProgress?: (progress: SnapshotProgress) => void
): Promise<boolean> {
  const db = await getDB();

  // Skip if we already have climb data
  const climbCount = await db.count("climbs");
  if (climbCount > 0) return false;

  onProgress?.({ pct: 0, stage: "Downloading climb data..." });

  // cache: 'reload' bypasses browser cache — this fetch only runs when
  // IndexedDB is empty (first visit or after clear), so re-downloading is fine.
  const response = await fetch("/data/db-snapshot.json", { cache: "reload" });
  if (!response.ok) {
    throw new Error(`Failed to fetch snapshot: ${response.status}`);
  }

  onProgress?.({ pct: 10, stage: "Parsing..." });

  const snapshot: SnapshotData = await response.json();

  // Bulk insert each table
  const tableNames = SNAPSHOT_TABLES.filter((t) => snapshot.tables[t]?.length > 0);
  const totalRows = tableNames.reduce((sum, t) => sum + snapshot.tables[t].length, 0);
  let insertedRows = 0;

  for (const table of tableNames) {
    const rows = snapshot.tables[table];
    const rowCount = rows.length.toLocaleString();
    onProgress?.({
      pct: 10 + Math.round((insertedRows / totalRows) * 85),
      stage: `Loading ${table} (${rowCount} rows)...`,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tx = db.transaction(table as any, "readwrite");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = tx.objectStore(table as any);
    for (const row of rows) {
      await store.put(row as never);
    }
    await tx.done;

    insertedRows += rows.length;
  }

  onProgress?.({ pct: 96, stage: "Setting sync cursors..." });

  // Write sync cursors so incremental sync starts from where the snapshot left off
  const syncTx = db.transaction("sync_state", "readwrite");
  for (const [table, syncDate] of Object.entries(snapshot.meta.sync_dates)) {
    await syncTx.objectStore("sync_state").put({
      table_name: table,
      last_synchronized_at: syncDate,
    });
  }
  await syncTx.done;

  // Invalidate all query caches
  invalidateClimbCache();
  invalidateCircuitCache();
  invalidateBlockCache();
  invalidateBetaClimbCache();

  onProgress?.({ pct: 100, stage: "Done" });
  return true;
}

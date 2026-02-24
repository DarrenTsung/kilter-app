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

// Essential tables loaded synchronously during phase 1
const ESSENTIAL_TABLES = [
  "climbs",
  "placements",
  "holes",
  "leds",
  "placement_roles",
  "difficulty_grades",
  "product_sizes_layouts_sets",
] as const;

const DEFAULT_ANGLE = 40;
const BATCH_SIZE = 1000;

export interface SnapshotProgress {
  pct: number;
  stage: string;
}

export interface SnapshotResult {
  loaded: boolean;
  deferred?: (onProgress?: (stage: string) => void) => Promise<void>;
}

/**
 * Insert rows in batches, committing each batch so that polling
 * queries (e.g. db.count) can see incremental progress.
 */
async function batchInsert(
  db: Awaited<ReturnType<typeof getDB>>,
  table: string,
  rows: Record<string, unknown>[]
) {
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tx = db.transaction(table as any, "readwrite");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = tx.objectStore(table as any);
    for (const row of batch) {
      await store.put(row as never);
    }
    await tx.done;
  }
}

/**
 * Load the pre-built snapshot into IndexedDB in two phases.
 *
 * Phase 1 (blocking): essential tables + climb_stats at default angle (40°).
 * Phase 2 (returned as `deferred`): remaining climb_stats angles + beta_links.
 *
 * Sync cursors are written for ALL snapshot tables in phase 1 so incremental
 * sync never re-fetches deferred data from epoch.
 */
export async function loadSnapshot(
  onProgress?: (progress: SnapshotProgress) => void
): Promise<SnapshotResult> {
  const db = await getDB();

  // Skip if we already have climb data
  const climbCount = await db.count("climbs");
  if (climbCount > 0) return { loaded: false };

  onProgress?.({ pct: 0, stage: "Downloading climb data..." });

  // cache: 'reload' bypasses browser cache — this fetch only runs when
  // IndexedDB is empty (first visit or after clear), so re-downloading is fine.
  const response = await fetch("/data/db-snapshot.json", { cache: "reload" });
  if (!response.ok) {
    throw new Error(`Failed to fetch snapshot: ${response.status}`);
  }

  onProgress?.({ pct: 10, stage: "Parsing..." });

  const snapshot: SnapshotData = await response.json();

  // --- Phase 1: essential tables ---
  const tableNames = ESSENTIAL_TABLES.filter(
    (t) => snapshot.tables[t]?.length > 0
  );
  const totalRows = tableNames.reduce(
    (sum, t) => sum + snapshot.tables[t].length,
    0
  );
  let insertedRows = 0;

  for (const table of tableNames) {
    const rows = snapshot.tables[table];
    const rowCount = rows.length.toLocaleString();
    onProgress?.({
      pct: 10 + Math.round((insertedRows / totalRows) * 70),
      stage: `Loading ${table} (${rowCount} rows)...`,
    });

    await batchInsert(db, table, rows);
    insertedRows += rows.length;
  }

  // --- Phase 1: climb_stats at default angle only ---
  const allClimbStats = snapshot.tables["climb_stats"] ?? [];
  const defaultAngleStats = allClimbStats.filter(
    (row) => row.angle === DEFAULT_ANGLE
  );
  const remainingStats = allClimbStats.filter(
    (row) => row.angle !== DEFAULT_ANGLE
  );

  if (defaultAngleStats.length > 0) {
    onProgress?.({
      pct: 82,
      stage: `Loading climb_stats at ${DEFAULT_ANGLE}° (${defaultAngleStats.length.toLocaleString()} rows)...`,
    });

    await batchInsert(db, "climb_stats", defaultAngleStats);
  }

  onProgress?.({ pct: 92, stage: "Setting sync cursors..." });

  // Write sync cursors for ALL snapshot tables (essential + deferred) so
  // incremental sync starts from where the snapshot left off — even for
  // tables not yet loaded (prevents sync from re-fetching from epoch).
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

  // --- Phase 2 (deferred): remaining climb_stats + beta_links ---
  const betaLinks = snapshot.tables["beta_links"] ?? [];

  const deferred =
    remainingStats.length > 0 || betaLinks.length > 0
      ? async (onProgress?: (stage: string) => void) => {
          const db = await getDB();

          if (remainingStats.length > 0) {
            onProgress?.(`Loading climb_stats for other angles (${remainingStats.length.toLocaleString()} rows)...`);
            await batchInsert(db, "climb_stats", remainingStats);
          }

          if (betaLinks.length > 0) {
            onProgress?.(`Loading beta_links (${betaLinks.length.toLocaleString()} rows)...`);
            await batchInsert(db, "beta_links", betaLinks);
          }

          invalidateClimbCache();
          invalidateBetaClimbCache();
        }
      : undefined;

  return { loaded: true, deferred };
}

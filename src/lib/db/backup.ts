import { getDB, resetDB } from "./index";
import { useSyncStore } from "@/store/syncStore";

export interface BackupPayload {
  version: number;
  exportedAt: string;
  indexedDB: Record<string, unknown[]>;
  localStorage: Record<string, string>;
}

const LOCALSTORAGE_KEYS = [
  "kilter-auth",
  "kilter-sync",
  "kilter-filters",
  "kilter-presets",
];

/**
 * Collect all IndexedDB stores + relevant localStorage into a JSON-serializable payload.
 */
export async function collectData(): Promise<BackupPayload> {
  const db = await getDB();
  const stores: Record<string, unknown[]> = {};

  for (let i = 0; i < db.objectStoreNames.length; i++) {
    const name = db.objectStoreNames[i];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await db.getAll(name as any);
    stores[name] = rows;
  }

  const ls: Record<string, string> = {};
  for (const key of LOCALSTORAGE_KEYS) {
    const val = localStorage.getItem(key);
    if (val !== null) ls[key] = val;
  }

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    indexedDB: stores,
    localStorage: ls,
  };
}

/**
 * Restore a backup payload into IndexedDB + localStorage, then reload the page.
 */
export async function restoreData(payload: BackupPayload): Promise<void> {
  if (!payload.version || !payload.indexedDB) {
    throw new Error("Invalid backup format");
  }

  // 1. Close existing DB connection
  await resetDB();

  // 2. Delete existing database
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase("kilter-app");
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });

  // 3. Re-open DB (triggers schema creation via upgrade handler)
  const db = await getDB();

  // 4. Write all stores in batched transactions
  for (const [storeName, rows] of Object.entries(payload.indexedDB)) {
    if (!Array.isArray(rows) || rows.length === 0) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (!db.objectStoreNames.contains(storeName as any)) {
      console.warn(`[backup] Skipping unknown store: ${storeName}`);
      continue;
    }

    // Batch in chunks to avoid massive single transactions
    const BATCH_SIZE = 5000;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tx = (db as any).transaction(storeName, "readwrite");
      for (const row of batch) {
        await tx.store.put(row);
      }
      await tx.done;
    }
  }

  // 5. Restore localStorage
  for (const [key, value] of Object.entries(payload.localStorage)) {
    localStorage.setItem(key, value);
  }

  // 6. Reset sync store flags so the snapshot loader doesn't re-fetch
  useSyncStore.setState({ snapshotLoaded: true });

  // 7. Reload to pick up restored data
  window.location.reload();
}

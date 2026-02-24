"use client";

import { useEffect, useRef, useState } from "react";
import { useSyncStore } from "@/store/syncStore";
import { useAuthStore } from "@/store/authStore";
import { loadSnapshot, type SnapshotProgress } from "@/lib/db/snapshot";
import { syncSharedData, syncUserData } from "@/lib/db/sync";
import { getDB } from "@/lib/db";

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

/** Run deferred snapshot loading (remaining angles + beta links). */
function runDeferred(
  ref: React.MutableRefObject<((onProgress?: (stage: string) => void) => Promise<void>) | null>,
  setSyncProgress: (p: string | null) => void
) {
  const deferred = ref.current;
  if (!deferred) return;
  ref.current = null;
  deferred(setSyncProgress).then(() => {
    setSyncProgress(null);
    console.log("[snapshot] Deferred tables loaded");
  });
}

export function SnapshotLoader() {
  const {
    snapshotLoaded,
    snapshotLoading,
    snapshotError,
    lastSyncedAt,
    setSnapshotLoaded,
    setSnapshotLoading,
    setSnapshotError,
    setSyncComplete,
    setSyncing,
    setSyncProgress,
    setSyncPct,
  } = useSyncStore();
  const { isLoggedIn, token, userId } = useAuthStore();
  const loadingRef = useRef(false);
  const refreshRef = useRef(false);
  const userSyncRef = useRef(false);
  const deferredRef = useRef<((onProgress?: (stage: string) => void) => Promise<void>) | null>(null);
  const [progress, setProgress] = useState<SnapshotProgress | null>(null);

  // On mount, verify snapshotLoaded matches reality (IndexedDB may have been
  // cleared while the persisted flag says true).
  useEffect(() => {
    if (!snapshotLoaded) return;
    let cancelled = false;
    getDB().then(async (db) => {
      const count = await db.count("climbs");
      if (count === 0 && !cancelled) {
        // Persisted flag is stale — DB was cleared
        useSyncStore.setState({ snapshotLoaded: false, lastSyncedAt: null });
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load snapshot on mount if not already loaded
  useEffect(() => {
    if (snapshotLoaded || snapshotLoading || loadingRef.current) return;
    loadingRef.current = true;
    setSnapshotLoading(true);

    loadSnapshot((p) => {
      setProgress(p);
      setSyncPct(p.pct);
      setSyncProgress(p.stage);
    })
      .then((result) => {
        if (result.loaded) {
          setSnapshotLoaded();
          setSyncComplete();
        } else {
          setSnapshotLoaded();
        }
        setSyncPct(null);
        // Store deferred for later — runs after user sync (if logged in)
        // or immediately via the effect below (if not logged in).
        if (result.deferred) {
          deferredRef.current = result.deferred;
        } else {
          setSyncProgress(null);
        }
      })
      .catch((err) => {
        console.error("[snapshot] Failed to load:", err);
        setSnapshotError(err instanceof Error ? err.message : "Failed to load climb data");
      })
      .finally(() => {
        loadingRef.current = false;
      });
  }, [snapshotLoaded, snapshotLoading, setSnapshotLoaded, setSnapshotLoading, setSnapshotError, setSyncComplete, setSyncProgress, setSyncPct]);

  // Run deferred immediately if user is not logged in (no user sync to wait for)
  useEffect(() => {
    if (!snapshotLoaded || isLoggedIn) return;
    runDeferred(deferredRef, setSyncProgress);
  }, [snapshotLoaded, isLoggedIn, setSyncProgress]);

  // Auto-sync user data once snapshot is loaded + user is logged in.
  // Runs deferred loading after sync completes to avoid IDB contention
  // (both write to climb_stats/beta_links).
  useEffect(() => {
    if (!snapshotLoaded || !isLoggedIn || !token || !userId || userSyncRef.current) return;
    userSyncRef.current = true;

    setSyncing(true);
    setSyncProgress("Syncing user data...");
    syncUserData(token, userId, (progress) => {
      setSyncProgress(
        progress.detail
          ? `${progress.stage} · ${progress.detail}`
          : progress.stage
      );
    })
      .then((counts) => {
        const total = Object.values(counts).reduce((a, b) => a + b, 0);
        if (total > 0) {
          console.log(`[snapshot] User sync: ${total} rows`);
        }
        setSyncComplete();
      })
      .catch((err) => {
        console.error("[snapshot] User sync failed:", err);
        setSyncing(false);
        setSyncProgress(null);
      })
      .finally(() => {
        runDeferred(deferredRef, setSyncProgress);
      });
  }, [snapshotLoaded, isLoggedIn, token, userId, setSyncComplete, setSyncing, setSyncProgress]);

  // Background refresh of shared data when stale
  useEffect(() => {
    if (!snapshotLoaded || !isLoggedIn || !token || refreshRef.current) return;

    const lastSync = lastSyncedAt ? new Date(lastSyncedAt).getTime() : 0;
    const isStale = Date.now() - lastSync > STALE_THRESHOLD_MS;
    if (!isStale) return;

    refreshRef.current = true;
    setSyncing(true);
    setSyncProgress("Refreshing shared data...");

    syncSharedData(token, (progress) => {
      setSyncProgress(
        progress.detail
          ? `${progress.stage} · ${progress.detail}`
          : progress.stage
      );
    })
      .then((counts) => {
        const total = Object.values(counts).reduce((a, b) => a + b, 0);
        if (total > 0) {
          console.log(`[snapshot] Background refresh: ${total} rows updated`);
        }
        setSyncComplete();
      })
      .catch((err) => {
        console.error("[snapshot] Background refresh failed:", err);
        setSyncing(false);
        setSyncProgress(null);
      });
  }, [snapshotLoaded, isLoggedIn, token, lastSyncedAt, setSyncComplete, setSyncing, setSyncProgress]);

  if (snapshotLoading && progress) {
    return (
      <div className="fixed top-0 left-0 right-0 z-50">
        {/* Progress bar */}
        <div className="h-1 bg-neutral-800">
          <div
            className="h-full bg-blue-500 transition-[width] duration-300 ease-out"
            style={{ width: `${progress.pct}%` }}
          />
        </div>
        {/* Stage label */}
        <div className="bg-neutral-900/90 px-4 py-1.5">
          <p className="text-xs text-neutral-400">{progress.stage}</p>
        </div>
      </div>
    );
  }

  if (snapshotLoading) {
    return (
      <div className="fixed top-0 left-0 right-0 z-50 h-1">
        <div className="h-full animate-pulse bg-blue-500" />
      </div>
    );
  }

  if (snapshotError) {
    return (
      <div className="fixed top-0 left-0 right-0 z-50 bg-red-600/90 px-4 py-2 text-center text-xs text-white">
        Failed to load climb data. Try refreshing.
      </div>
    );
  }

  return null;
}

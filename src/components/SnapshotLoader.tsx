"use client";

import { useEffect, useRef } from "react";
import { useSyncStore } from "@/store/syncStore";
import { useAuthStore } from "@/store/authStore";
import { loadSnapshot } from "@/lib/db/snapshot";
import { syncSharedData, syncUserData } from "@/lib/db/sync";
import { getDB } from "@/lib/db";

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

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
  } = useSyncStore();
  const { isLoggedIn, token, userId } = useAuthStore();
  const loadingRef = useRef(false);
  const refreshRef = useRef(false);
  const userSyncRef = useRef(false);

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

    loadSnapshot()
      .then((loaded) => {
        if (loaded) {
          setSnapshotLoaded();
          setSyncComplete();
        } else {
          // DB already had data — mark as loaded
          setSnapshotLoaded();
        }
      })
      .catch((err) => {
        console.error("[snapshot] Failed to load:", err);
        setSnapshotError(err instanceof Error ? err.message : "Failed to load climb data");
      })
      .finally(() => {
        loadingRef.current = false;
      });
  }, [snapshotLoaded, snapshotLoading, setSnapshotLoaded, setSnapshotLoading, setSnapshotError, setSyncComplete]);

  // Auto-sync user data once snapshot is loaded + user is logged in
  useEffect(() => {
    if (!snapshotLoaded || !isLoggedIn || !token || !userId || userSyncRef.current) return;
    userSyncRef.current = true;

    console.log("[snapshot] Snapshot ready + logged in, syncing user data...");
    syncUserData(token, userId)
      .then((counts) => {
        const total = Object.values(counts).reduce((a, b) => a + b, 0);
        if (total > 0) {
          console.log(`[snapshot] User sync: ${total} rows`);
          setSyncComplete();
        }
      })
      .catch((err) => {
        console.error("[snapshot] User sync failed:", err);
      });
  }, [snapshotLoaded, isLoggedIn, token, userId, setSyncComplete]);

  // Background refresh of shared data when stale
  useEffect(() => {
    if (!snapshotLoaded || !isLoggedIn || !token || refreshRef.current) return;

    const lastSync = lastSyncedAt ? new Date(lastSyncedAt).getTime() : 0;
    const isStale = Date.now() - lastSync > STALE_THRESHOLD_MS;
    if (!isStale) return;

    refreshRef.current = true;
    console.log("[snapshot] Shared data is stale, refreshing in background...");

    syncSharedData(token)
      .then((counts) => {
        const total = Object.values(counts).reduce((a, b) => a + b, 0);
        if (total > 0) {
          console.log(`[snapshot] Background refresh: ${total} rows updated`);
          setSyncComplete();
        }
      })
      .catch((err) => {
        console.error("[snapshot] Background refresh failed:", err);
      });
  }, [snapshotLoaded, isLoggedIn, token, lastSyncedAt, setSyncComplete]);

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

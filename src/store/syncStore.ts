import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SyncState {
  lastSyncedAt: string | null;
  isSyncing: boolean;
  syncProgress: string | null;
  syncError: string | null;
  snapshotLoaded: boolean;
  snapshotLoading: boolean;
  snapshotError: string | null;
  setSyncing: (syncing: boolean) => void;
  setSyncProgress: (progress: string | null) => void;
  setSyncError: (error: string | null) => void;
  setSyncComplete: () => void;
  setSnapshotLoaded: () => void;
  setSnapshotLoading: (loading: boolean) => void;
  setSnapshotError: (error: string | null) => void;
}

export const useSyncStore = create<SyncState>()(
  persist(
    (set) => ({
      lastSyncedAt: null,
      isSyncing: false,
      syncProgress: null,
      syncError: null,
      snapshotLoaded: false,
      snapshotLoading: false,
      snapshotError: null,
      setSyncing: (isSyncing) => set({ isSyncing, syncError: null }),
      setSyncProgress: (syncProgress) => set({ syncProgress }),
      setSyncError: (syncError) => set({ syncError, isSyncing: false }),
      setSyncComplete: () =>
        set({
          lastSyncedAt: new Date().toISOString(),
          isSyncing: false,
          syncProgress: null,
        }),
      setSnapshotLoaded: () =>
        set({ snapshotLoaded: true, snapshotLoading: false, snapshotError: null }),
      setSnapshotLoading: (snapshotLoading) => set({ snapshotLoading }),
      setSnapshotError: (snapshotError) =>
        set({ snapshotError, snapshotLoading: false }),
    }),
    {
      name: "kilter-sync",
      // Only persist these fields — transient state resets on reload
      partialize: (state) => ({
        lastSyncedAt: state.lastSyncedAt,
        snapshotLoaded: state.snapshotLoaded,
      }),
      onRehydrateStorage: () => () => {
        // If the page reloads mid-sync, the persisted isSyncing=true is stale.
        // Reset transient state so buttons aren't permanently disabled.
        useSyncStore.setState({
          isSyncing: false,
          syncProgress: null,
          snapshotLoading: false,
          snapshotError: null,
        });
      },
    }
  )
);

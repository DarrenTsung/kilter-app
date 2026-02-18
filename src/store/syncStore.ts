import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SyncState {
  lastSyncedAt: string | null;
  isSyncing: boolean;
  syncProgress: string | null;
  syncError: string | null;
  setSyncing: (syncing: boolean) => void;
  setSyncProgress: (progress: string | null) => void;
  setSyncError: (error: string | null) => void;
  setSyncComplete: () => void;
}

export const useSyncStore = create<SyncState>()(
  persist(
    (set) => ({
      lastSyncedAt: null,
      isSyncing: false,
      syncProgress: null,
      syncError: null,
      setSyncing: (isSyncing) => set({ isSyncing, syncError: null }),
      setSyncProgress: (syncProgress) => set({ syncProgress }),
      setSyncError: (syncError) => set({ syncError, isSyncing: false }),
      setSyncComplete: () =>
        set({
          lastSyncedAt: new Date().toISOString(),
          isSyncing: false,
          syncProgress: null,
        }),
    }),
    {
      name: "kilter-sync",
      onRehydrateStorage: () => () => {
        // If the page reloads mid-sync, the persisted isSyncing=true is stale.
        // Reset it so the button isn't permanently disabled.
        useSyncStore.setState({ isSyncing: false, syncProgress: null });
      },
    }
  )
);

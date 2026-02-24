"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { useAuthStore } from "@/store/authStore";
import { useSyncStore } from "@/store/syncStore";
import { login } from "@/lib/api/aurora";
import { syncUserData } from "@/lib/db/sync";
import { getDB, resetDB } from "@/lib/db";
import {
  useFilterStore,
  ANGLES,
  AUTO_DISCONNECT_OPTIONS,
} from "@/store/filterStore";
import { useBleStore } from "@/store/bleStore";
import { getBlockedSet, invalidateBlockCache, getUserCircuits, invalidateCircuitCache } from "@/lib/db/queries";
import { saveTag, deleteCircuit } from "@/lib/api/aurora";
import { disconnect } from "@/lib/ble/connection";
import { CircuitEditModal } from "./CircuitEditModal";
import { circuitDisplayColor } from "@/lib/circuitColors";

export function SettingsContent() {
  const { isLoggedIn, username, token, userId, logout } = useAuthStore();

  return (
    <div className="px-4 pt-5">
      <h1 className="text-2xl font-bold uppercase tracking-wide">Settings</h1>

      <section className="mt-4">
        <h2 className="text-lg font-semibold uppercase tracking-wide text-neutral-300">Account</h2>
        {isLoggedIn ? (
          <LoggedInView username={username} onLogout={logout} />
        ) : (
          <LoginForm />
        )}
      </section>

      <section className="mt-4">
        <h2 className="text-lg font-normal uppercase tracking-wide text-neutral-300">Board</h2>
        <AngleSelector />
      </section>

      <section className="mt-4">
        <h2 className="text-lg font-normal uppercase tracking-wide text-neutral-300">Preferences</h2>
        <BlockSection token={token} userId={userId} />
      </section>

      <section className="mt-4">
        <h2 className="text-lg font-normal uppercase tracking-wide text-neutral-300">Circuits</h2>
        <CircuitSection userId={userId} />
      </section>

      <section className="mt-4">
        <h2 className="text-lg font-normal uppercase tracking-wide text-neutral-300">Bluetooth</h2>
        <BluetoothSection />
      </section>

      <section className="mt-4">
        <h2 className="text-lg font-normal uppercase tracking-wide text-neutral-300">
          Data Sync
        </h2>
        <SyncSection token={token} userId={userId} isLoggedIn={isLoggedIn} />
      </section>

      <section className="mt-4 mb-8">
        <h2 className="text-lg font-normal uppercase tracking-wide text-neutral-300">Debug</h2>
        <ClearDataSection />
      </section>
    </div>
  );
}

function LoggedInView({
  username,
  onLogout,
}: {
  username: string | null;
  onLogout: () => void;
}) {
  return (
    <div className="mt-1 rounded-lg bg-neutral-800 py-2 px-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="label text-sm text-neutral-400">Logged in as</p>
          <p className="font-medium">{username}</p>
        </div>
        <button
          onClick={onLogout}
          className="rounded-lg bg-neutral-700 px-4 py-2 text-sm transition-colors hover:bg-neutral-600"
        >
          Log out
        </button>
      </div>
    </div>
  );
}

// Cache table counts so they persist across tab switches
let cachedTableCounts: Record<string, number> = {};

function SyncSection({
  token,
  userId,
  isLoggedIn,
}: {
  token: string | null;
  userId: number | null;
  isLoggedIn: boolean;
}) {
  const [tableCounts, setTableCounts] = useState<Record<string, number>>(cachedTableCounts);
  const {
    lastSyncedAt,
    isSyncing,
    snapshotLoaded,
    snapshotLoading,
    syncProgress,
    syncPct,
    syncError,
    setSyncing,
    setSyncProgress,
    setSyncError,
    setSyncComplete,
  } = useSyncStore();

  const abortRef = useRef<AbortController | null>(null);

  async function loadTableCounts() {
    try {
      const db = await getDB();
      const counts: Record<string, number> = {};
      for (let i = 0; i < db.objectStoreNames.length; i++) {
        const table = db.objectStoreNames[i];
        if (table === "sync_state" || table === "product_sizes_layouts_sets" || table === "placement_roles" || table === "difficulty_grades") continue;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        counts[table] = await db.count(table as any);
      }
      cachedTableCounts = counts;
      setTableCounts(counts);
    } catch {
      // DB may not be ready yet during initial snapshot load
    }
  }

  // Poll table counts while any loading/syncing is active
  const isActive = snapshotLoading || isSyncing || syncProgress !== null;
  useEffect(() => {
    loadTableCounts();
    if (!isActive) return;
    const interval = setInterval(loadTableCounts, 1000);
    return () => clearInterval(interval);
  }, [isActive]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSync() {
    if (!token || !userId || !snapshotLoaded) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setSyncing(true);
    setSyncProgress("Starting sync...");

    try {
      const counts = await syncUserData(
        token,
        userId,
        (progress) => {
          setSyncProgress(
            progress.detail
              ? `${progress.stage} · ${progress.detail}`
              : progress.stage
          );
        },
        controller.signal
      );

      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      setSyncProgress(`Done · ${total.toLocaleString()} rows synced`);
      setSyncComplete();
    } catch (err) {
      if (controller.signal.aborted) {
        setSyncError("Sync cancelled — progress saved. Tap Sync to resume.");
      } else {
        setSyncError(
          (err instanceof Error ? err.message : "Sync failed") +
          " — progress saved. Tap Sync to resume."
        );
      }
    } finally {
      abortRef.current = null;
    }
  }

  function handleCancel() {
    abortRef.current?.abort();
    // Force-reset UI immediately — don't wait for the fetch to actually abort,
    // since mobile browsers may not interrupt a hanging request promptly.
    setSyncError("Sync cancelled — progress saved. Tap Sync to resume.");
    abortRef.current = null;
  }

  const showProgressBar = syncPct !== null || (isActive && !syncError);

  return (
    <div className="mt-1 space-y-3">
      <div className="rounded-lg bg-neutral-800 py-2 px-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="label text-sm text-neutral-400">Last synced</p>
            <p className="text-sm font-medium">
              {lastSyncedAt
                ? new Date(lastSyncedAt).toLocaleString()
                : "Never"}
            </p>
          </div>
          {isLoggedIn && (isSyncing ? (
            <button
              onClick={handleCancel}
              className="rounded-lg bg-neutral-700 px-4 py-2 text-sm font-medium text-neutral-300 transition-colors hover:bg-neutral-600"
            >
              Cancel
            </button>
          ) : (
            <button
              onClick={handleSync}
              disabled={!snapshotLoaded}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
            >
              {!snapshotLoaded ? "Loading..." : syncError ? "Resume Sync" : "Sync Now"}
            </button>
          ))}
        </div>

        {showProgressBar && (
          <div className="mt-2 h-1 rounded-full bg-neutral-700 overflow-hidden">
            {syncPct !== null ? (
              <div
                className="h-full bg-blue-500 transition-[width] duration-300 ease-out"
                style={{ width: `${syncPct}%` }}
              />
            ) : (
              <div className="h-full w-full animate-pulse bg-blue-500" />
            )}
          </div>
        )}
        {syncProgress && (
          <p className={`${showProgressBar ? "mt-1" : "mt-2"} text-xs text-neutral-400`}>{syncProgress}</p>
        )}
        {syncError && (
          <p className="mt-2 text-xs text-red-400">{syncError}</p>
        )}

        {Object.keys(tableCounts).length > 0 && (
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5">
            {Object.entries(tableCounts).map(([t, count]) => (
              <div key={t} className="flex justify-between text-xs">
                <span className="text-neutral-500">{t}</span>
                <span className="text-neutral-400 tabular-nums">{count.toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function LoginForm() {
  const { login: storeLogin } = useAuthStore();
  const [usernameInput, setUsernameInput] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const result = await login(usernameInput, password);
      // SnapshotLoader auto-syncs user data once isLoggedIn becomes true
      storeLogin(result.token, result.user_id, usernameInput);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-1 space-y-4">
      <div>
        <label
          htmlFor="username"
          className="block text-sm font-medium text-neutral-400"
        >
          Username
        </label>
        <input
          id="username"
          type="text"
          autoComplete="username"
          value={usernameInput}
          onChange={(e) => setUsernameInput(e.target.value)}
          className="mt-1 block w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2.5 text-white placeholder-neutral-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          placeholder="Kilter username"
          required
        />
      </div>
      <div>
        <label
          htmlFor="password"
          className="block text-sm font-medium text-neutral-400"
        >
          Password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 block w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2.5 text-white placeholder-neutral-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          placeholder="Password"
          required
        />
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-blue-600 px-4 py-2.5 font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
      >
        {loading ? "Logging in..." : "Log in"}
      </button>
    </form>
  );
}

function AngleSelector() {
  const { angle, setAngle } = useFilterStore();
  const angleIndex = ANGLES.indexOf(angle);

  return (
    <div className="mt-1 rounded-lg bg-neutral-800 py-2 px-3">
      <div className="flex items-center justify-between">
        <p className="label text-sm text-neutral-400">Board angle</p>
        <p className="text-lg font-semibold">{angle}°</p>
      </div>
      <input
        type="range"
        min={0}
        max={ANGLES.length - 1}
        value={angleIndex}
        onChange={(e) => setAngle(ANGLES[Number(e.target.value)])}
        className="mt-1 w-full accent-blue-500"
      />
      <div className="mt-1 flex justify-between text-xs text-neutral-600">
        <span>{ANGLES[0]}°</span>
        <span>{ANGLES[ANGLES.length - 1]}°</span>
      </div>
    </div>
  );
}

function BluetoothSection() {
  const { status, deviceName } = useBleStore();
  const { autoDisconnect, setAutoDisconnect } = useFilterStore();

  return (
    <div className="mt-1 space-y-3">
      {/* Connection status */}
      <div className="rounded-lg bg-neutral-800 py-2 px-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="label text-sm text-neutral-400">Board connection</p>
            <p className="text-sm font-medium">
              {status === "connected"
                ? deviceName ?? "Connected"
                : status === "disconnected"
                  ? "Not connected"
                  : status.charAt(0).toUpperCase() + status.slice(1)}
            </p>
          </div>
          {status === "connected" && (
            <button
              onClick={disconnect}
              className="rounded-lg bg-neutral-700 px-4 py-2 text-sm transition-colors hover:bg-neutral-600"
            >
              Disconnect
            </button>
          )}
        </div>
      </div>

      {/* Auto-disconnect timeout */}
      <div className="rounded-lg bg-neutral-800 py-2 px-3">
        <p className="label text-sm text-neutral-400">Auto-disconnect timeout</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {AUTO_DISCONNECT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setAutoDisconnect(opt.value)}
              className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${autoDisconnect === opt.value
                ? "bg-blue-600 text-white"
                : "bg-neutral-700 text-neutral-300 hover:bg-neutral-600"
                }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-neutral-500">
          {autoDisconnect === 0
            ? "Board stays connected. Swiping auto-lights the next climb."
            : `Board disconnects ${autoDisconnect}s after lighting up. Tap the lightbulb icon to reconnect.`}
        </p>
      </div>
    </div>
  );
}

function BlockSection({ token, userId }: { token: string | null; userId: number | null }) {
  const [count, setCount] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    if (!userId) { setCount(0); return; }
    getBlockedSet(userId).then((s) => setCount(s.size));
  }, [userId]);

  async function handleClearAll() {
    if (!userId) return;
    setClearing(true);
    try {
      const db = await getDB();
      const blocked = await getBlockedSet(userId);
      // Unblock each in IndexedDB
      const tx = db.transaction("tags", "readwrite");
      for (const uuid of blocked) {
        await tx.store.put({
          entity_uuid: uuid,
          user_id: userId,
          name: "~block",
          is_listed: 0,
        });
      }
      await tx.done;
      invalidateBlockCache();
      setCount(0);
      setConfirming(false);
      // Fire API calls in background
      if (token) {
        for (const uuid of blocked) {
          saveTag(token, userId, uuid, false).catch(console.error);
        }
      }
    } finally {
      setClearing(false);
    }
  }

  if (count === null || count === 0) {
    return (
      <div className="mt-1 rounded-lg bg-neutral-800 p-2">
        <p className="text-sm text-neutral-500">No blocked climbs</p>
      </div>
    );
  }

  return (
    <div className="mt-1 rounded-lg bg-neutral-800 p-2">
      <div className="flex items-center justify-between">
        <p className="text-sm text-neutral-400 pr-4">
          {count} blocked climb{count !== 1 ? "s" : ""} hidden from shuffle
        </p>
        {!confirming && (
          <button
            onClick={() => setConfirming(true)}
            className="rounded-lg bg-neutral-700 px-3 py-1.5 text-sm transition-colors hover:bg-neutral-600"
          >
            Clear all
          </button>
        )}
      </div>
      {confirming && (
        <div className="mt-1 flex gap-2">
          <button
            onClick={handleClearAll}
            disabled={clearing}
            className="flex-1 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-red-500 disabled:opacity-50"
          >
            {clearing ? "Clearing..." : `Unblock ${count} climb${count !== 1 ? "s" : ""}`}
          </button>
          <button
            onClick={() => setConfirming(false)}
            className="rounded-lg bg-neutral-700 px-3 py-2 text-sm transition-colors hover:bg-neutral-600"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

interface CircuitRow {
  uuid: string;
  name: string;
  color: string;
  apiColor: string;
  description: string;
  isPublic: boolean;
}

function CircuitSection({ userId }: { userId: number | null }) {
  const [circuits, setCircuits] = useState<CircuitRow[]>([]);
  const [listOpen, setListOpen] = useState(false);
  const [editing, setEditing] = useState<CircuitRow | null>(null);

  useEffect(() => {
    if (!userId) { setCircuits([]); return; }
    getUserCircuits(userId).then((rows) =>
      setCircuits(rows.map((r) => ({
        uuid: r.uuid,
        name: r.name,
        color: r.color,
        apiColor: r.apiColor,
        description: r.description,
        isPublic: r.is_public === 1,
      })))
    );
  }, [userId]);

  if (!userId || circuits.length === 0) {
    return (
      <div className="mt-1 rounded-lg bg-neutral-800 p-2">
        <p className="text-sm text-neutral-500">No circuits</p>
      </div>
    );
  }

  return (
    <>
      <div className="mt-1 rounded-lg bg-neutral-800 py-2 px-3">
        <div className="flex items-center justify-between">
          <p className="text-sm text-neutral-400">
            {circuits.length} circuit{circuits.length !== 1 ? "s" : ""}
          </p>
          <button
            onClick={() => setListOpen(true)}
            className="rounded-lg bg-neutral-700 px-4 py-2 text-sm transition-colors hover:bg-neutral-600"
          >
            Manage
          </button>
        </div>
      </div>
      {listOpen && (
        <CircuitListModal
          circuits={circuits}
          onClose={() => setListOpen(false)}
          onEdit={(c) => { setEditing(c); setListOpen(false); }}
          onDeleted={(uuid) => {
            setCircuits((prev) => prev.filter((c) => c.uuid !== uuid));
            invalidateCircuitCache();
          }}
        />
      )}
      {editing && (
        <CircuitEditModal
          circuit={editing}
          onClose={() => setEditing(null)}
          onSaved={(updated) => {
            setCircuits((prev) =>
              prev.map((c) =>
                c.uuid === editing.uuid
                  ? {
                      ...c,
                      name: updated.name,
                      apiColor: updated.apiColor,
                      color: circuitDisplayColor(updated.apiColor),
                      description: updated.description,
                      isPublic: updated.isPublic,
                    }
                  : c
              )
            );
          }}
        />
      )}
    </>
  );
}

function CircuitListModal({
  circuits,
  onClose,
  onEdit,
  onDeleted,
}: {
  circuits: CircuitRow[];
  onClose: () => void;
  onEdit: (circuit: CircuitRow) => void;
  onDeleted: (uuid: string) => void;
}) {
  const { token } = useAuthStore();
  const [open, setOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [climbCounts, setClimbCounts] = useState<Map<string, number>>(new Map());

  useEffect(() => { setOpen(true); }, []);

  useEffect(() => {
    async function loadCounts() {
      const db = await getDB();
      const counts = new Map<string, number>();
      for (const c of circuits) {
        const links = await db.getAllFromIndex("circuits_climbs", "by-circuit", c.uuid);
        counts.set(c.uuid, links.length);
      }
      setClimbCounts(counts);
    }
    loadCounts();
  }, [circuits]);

  const animateClose = useCallback(() => {
    setOpen(false);
    setTimeout(onClose, 200);
  }, [onClose]);

  async function handleDelete(uuid: string) {
    setDeleting(true);
    try {
      const db = await getDB();
      const links = await db.getAllFromIndex("circuits_climbs", "by-circuit", uuid);
      const tx = db.transaction("circuits_climbs", "readwrite");
      for (const link of links) {
        await tx.store.delete([link.circuit_uuid, link.climb_uuid]);
      }
      await tx.done;
      await db.delete("circuits", uuid);
      invalidateCircuitCache();
      if (token) {
        deleteCircuit(token, uuid).catch(console.error);
      }
      onDeleted(uuid);
      setConfirmingDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  return createPortal(
    <motion.div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60"
      onClick={animateClose}
      animate={{ opacity: open ? 1 : 0 }}
      transition={{ duration: 0.15 }}
    >
      <motion.div
        className="w-full max-w-md rounded-t-2xl bg-neutral-800 p-4 pb-8"
        onClick={(e) => e.stopPropagation()}
        animate={{ y: open ? 0 : "100%" }}
        transition={{ type: "spring", stiffness: 400, damping: 35 }}
      >
        <h3 className="text-lg font-bold uppercase tracking-wide">Circuits</h3>
        <div className="mt-3 divide-y divide-neutral-700 rounded-lg bg-neutral-700/30">
          {circuits.map((c) => (
            <div key={c.uuid}>
              <div className="flex items-center gap-3 px-3 py-2">
                <span
                  className="h-3 w-3 flex-shrink-0 rounded-full"
                  style={{ backgroundColor: c.color }}
                />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium text-neutral-200 truncate">{c.name}</span>
                  <span className="block text-xs text-neutral-500">{climbCounts.get(c.uuid) ?? 0} climbs</span>
                </span>
                <button
                  onClick={() => { onEdit(c); animateClose(); }}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-neutral-500 active:bg-neutral-600 active:text-neutral-200"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                    <path d="M2.695 14.763l-1.262 3.154a.5.5 0 00.65.65l3.155-1.262a4 4 0 001.343-.885L17.5 5.5a2.121 2.121 0 00-3-3L3.58 13.42a4 4 0 00-.885 1.343z" />
                  </svg>
                </button>
                <button
                  onClick={() => setConfirmingDelete(confirmingDelete === c.uuid ? null : c.uuid)}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-neutral-500 active:bg-neutral-600 active:text-red-400"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                    <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
              {confirmingDelete === c.uuid && (
                <div className="px-3 pb-2">
                  <p className="text-xs text-neutral-400 mb-1.5 text-right">Delete {climbCounts.get(c.uuid) ?? 0} climbs? Can&apos;t undo.</p>
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => handleDelete(c.uuid)}
                      disabled={deleting}
                      className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white active:bg-red-500 disabled:opacity-50"
                    >
                      {deleting ? "Deleting..." : "Delete"}
                    </button>
                    <button
                      onClick={() => setConfirmingDelete(null)}
                      className="rounded-lg bg-neutral-700 px-4 py-2 text-sm font-medium text-neutral-300 active:bg-neutral-600"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </motion.div>
    </motion.div>,
    document.body
  );
}

function ClearDataSection() {
  const [confirming, setConfirming] = useState(false);
  const [clearing, setClearing] = useState(false);

  async function handleClear() {
    setClearing(true);
    try {
      // Close the open connection first so deleteDatabase does not hang
      await resetDB();
      // Delete the database
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.deleteDatabase("kilter-app");
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
      // Reset sync store state and persisted localStorage
      useSyncStore.setState({
        lastSyncedAt: null,
        snapshotLoaded: false,
        snapshotLoading: false,
        snapshotError: null,
        isSyncing: false,
        syncProgress: null,
        syncError: null,
      });
      localStorage.removeItem("kilter-sync");
      // Reload to get a fresh start
      window.location.reload();
    } catch (err) {
      console.error("Failed to clear data:", err);
      setClearing(false);
    }
  }

  return (
    <div className="mt-1 rounded-lg bg-neutral-800 py-2 px-3">
      {!confirming ? (
        <button
          onClick={() => setConfirming(true)}
          className="text-sm text-red-400 active:text-red-300"
        >
          Clear Local Data
        </button>
      ) : (
        <div>
          <p className="text-xs text-neutral-400">
            This will delete all local climb data and reload the app. Your
            account and cloud data are not affected.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              onClick={handleClear}
              disabled={clearing}
              className="flex-1 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white active:bg-red-500 disabled:opacity-50"
            >
              {clearing ? "Clearing..." : "Confirm Clear"}
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="rounded-lg bg-neutral-700 px-3 py-2 text-sm transition-colors hover:bg-neutral-600"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

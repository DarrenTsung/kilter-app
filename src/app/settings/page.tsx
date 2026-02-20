"use client";

import { useState, useRef, useEffect } from "react";
import { useAuthStore } from "@/store/authStore";
import { useSyncStore } from "@/store/syncStore";
import { login } from "@/lib/api/aurora";
import { syncAll } from "@/lib/db/sync";
import { getDB } from "@/lib/db";
import {
  useFilterStore,
  ANGLES,
  AUTO_DISCONNECT_OPTIONS,
} from "@/store/filterStore";
import { useBleStore } from "@/store/bleStore";
import { getBlockedSet, invalidateBlockCache } from "@/lib/db/queries";
import { saveTag } from "@/lib/api/aurora";
import { disconnect } from "@/lib/ble/connection";

export default function SettingsPage() {
  const { isLoggedIn, username, token, userId, logout } = useAuthStore();

  return (
    <div className="px-4 py-2">
      <h1 className="text-2xl font-bold">Settings</h1>

      <section className="mt-4">
        <h2 className="text-lg font-semibold text-neutral-300">Account</h2>
        {isLoggedIn ? (
          <LoggedInView username={username} onLogout={logout} />
        ) : (
          <LoginForm />
        )}
      </section>

      <section className="mt-4">
        <h2 className="text-lg font-normal text-neutral-300">Board</h2>
        <AngleSelector />
      </section>

      <section className="mt-4">
        <h2 className="text-lg font-normal text-neutral-300">Preferences</h2>
        <BlockSection token={token} userId={userId} />
      </section>

      <section className="mt-4">
        <h2 className="text-lg font-normal text-neutral-300">Bluetooth</h2>
        <BluetoothSection />
      </section>

      {isLoggedIn && (
        <section className="mt-4">
          <h2 className="text-lg font-normal text-neutral-300">
            Data Sync
          </h2>
          <SyncSection token={token} userId={userId} />
        </section>
      )}

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

function SyncSection({
  token,
  userId,
}: {
  token: string | null;
  userId: number | null;
}) {
  const [tableCounts, setTableCounts] = useState<Record<string, number>>({});
  const {
    lastSyncedAt,
    isSyncing,
    syncProgress,
    syncError,
    setSyncing,
    setSyncProgress,
    setSyncError,
    setSyncComplete,
  } = useSyncStore();

  const abortRef = useRef<AbortController | null>(null);

  async function loadTableCounts() {
    const db = await getDB();
    const counts: Record<string, number> = {};
    for (let i = 0; i < db.objectStoreNames.length; i++) {
      const table = db.objectStoreNames[i];
      if (table === "sync_state" || table === "product_sizes_layouts_sets" || table === "placement_roles" || table === "difficulty_grades") continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      counts[table] = await db.count(table as any);
    }
    setTableCounts(counts);
  }

  // Load counts on mount and after sync completes
  useEffect(() => { loadTableCounts(); }, [isSyncing]);

  async function handleSync() {
    const controller = new AbortController();
    abortRef.current = controller;
    setSyncing(true);
    setSyncProgress("Starting sync...");

    try {
      const counts = await syncAll(
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
          {isSyncing ? (
            <button
              onClick={handleCancel}
              className="rounded-lg bg-neutral-700 px-4 py-2 text-sm font-medium text-neutral-300 transition-colors hover:bg-neutral-600"
            >
              Cancel
            </button>
          ) : (
            <button
              onClick={handleSync}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500"
            >
              {syncError ? "Resume Sync" : "Sync Now"}
            </button>
          )}
        </div>

        {syncProgress && (
          <p className="mt-2 text-xs text-neutral-400">{syncProgress}</p>
        )}
        {syncError && (
          <p className="mt-2 text-xs text-red-400">{syncError}</p>
        )}

        {Object.keys(tableCounts).length > 0 && (
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5">
            {Object.entries(tableCounts).map(([t, count]) => (
              <div key={t} className="flex justify-between text-xs">
                <span className="text-neutral-500">{t}</span>
                <span className="text-neutral-400">{count.toLocaleString()}</span>
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


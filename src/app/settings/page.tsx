"use client";

import { useState } from "react";
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
import { useDislikeStore } from "@/store/dislikeStore";
import { disconnect } from "@/lib/ble/connection";

export default function SettingsPage() {
  const { isLoggedIn, username, token, userId, logout } = useAuthStore();

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold">Settings</h1>

      <section className="mt-6">
        <h2 className="text-lg font-semibold text-neutral-300">Account</h2>
        {isLoggedIn ? (
          <LoggedInView username={username} onLogout={logout} />
        ) : (
          <LoginForm />
        )}
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-semibold text-neutral-300">Board</h2>
        <AngleSelector />
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-semibold text-neutral-300">Preferences</h2>
        <DislikeSection />
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-semibold text-neutral-300">Bluetooth</h2>
        <BluetoothSection />
      </section>

      {isLoggedIn && (
        <section className="mt-6">
          <h2 className="text-lg font-semibold text-neutral-300">
            Data Sync
          </h2>
          <SyncSection token={token} userId={userId} />
        </section>
      )}

      {isLoggedIn && (
        <section className="mt-6">
          <h2 className="text-lg font-semibold text-neutral-300">
            Debug: DB Stats
          </h2>
          <DbStats />
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
    <div className="mt-3 rounded-lg bg-neutral-800 p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-neutral-400">Logged in as</p>
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

  async function handleSync() {
    setSyncing(true);
    setSyncProgress("Starting sync...");

    try {
      const counts = await syncAll(token, userId, (progress) => {
        const tableInfo = Object.entries(progress.tableCounts)
          .map(([t, c]) => `${t}: ${c}`)
          .join(", ");
        setSyncProgress(
          `${progress.phase} tables — page ${progress.page}${
            tableInfo ? ` (${tableInfo})` : ""
          }`
        );
      });

      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      setSyncProgress(`Synced ${total} rows`);
      setSyncComplete();
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : "Sync failed");
    }
  }

  return (
    <div className="mt-3 space-y-3">
      <div className="rounded-lg bg-neutral-800 p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-neutral-400">Last synced</p>
            <p className="text-sm font-medium">
              {lastSyncedAt
                ? new Date(lastSyncedAt).toLocaleString()
                : "Never"}
            </p>
          </div>
          <button
            onClick={handleSync}
            disabled={isSyncing}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
          >
            {isSyncing ? "Syncing..." : "Sync Now"}
          </button>
        </div>

        {syncProgress && (
          <p className="mt-2 text-xs text-neutral-400">{syncProgress}</p>
        )}
        {syncError && (
          <p className="mt-2 text-xs text-red-400">{syncError}</p>
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
    <form onSubmit={handleSubmit} className="mt-3 space-y-4">
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
    <div className="mt-3 rounded-lg bg-neutral-800 p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-neutral-400">Board angle</p>
        <p className="text-lg font-semibold">{angle}°</p>
      </div>
      <input
        type="range"
        min={0}
        max={ANGLES.length - 1}
        value={angleIndex}
        onChange={(e) => setAngle(ANGLES[Number(e.target.value)])}
        className="mt-3 w-full accent-blue-500"
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
    <div className="mt-3 space-y-3">
      {/* Connection status */}
      <div className="rounded-lg bg-neutral-800 p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-neutral-400">Board connection</p>
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
      <div className="rounded-lg bg-neutral-800 p-4">
        <p className="text-sm text-neutral-400">Auto-disconnect timeout</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {AUTO_DISCONNECT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setAutoDisconnect(opt.value)}
              className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                autoDisconnect === opt.value
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

function DislikeSection() {
  const { dislikedUuids, clearAll } = useDislikeStore();
  const count = dislikedUuids.length;

  if (count === 0) {
    return (
      <div className="mt-3 rounded-lg bg-neutral-800 p-4">
        <p className="text-sm text-neutral-500">No disliked climbs</p>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-lg bg-neutral-800 p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-neutral-400">
          {count} disliked climb{count !== 1 ? "s" : ""} hidden from shuffle
        </p>
        <button
          onClick={clearAll}
          className="rounded-lg bg-neutral-700 px-3 py-1.5 text-sm transition-colors hover:bg-neutral-600"
        >
          Clear all
        </button>
      </div>
    </div>
  );
}

function DbStats() {
  const [stats, setStats] = useState<string | null>(null);

  async function checkDb() {
    try {
      const db = await getDB();
      const stores = [
        "climbs",
        "climb_stats",
        "placements",
        "holes",
        "leds",
        "placement_roles",
        "difficulty_grades",
        "ascents",
        "sync_state",
      ] as const;

      const counts: Record<string, number> = {};
      for (const store of stores) {
        counts[store] = await db.count(store);
      }

      // Sample a climb_stats row to check structure
      let sampleStat = "none";
      const allStats = await db.getAll("climb_stats");
      if (allStats.length > 0) {
        const s = allStats[0];
        sampleStat = JSON.stringify(s, null, 2);
      }

      // Check how many climb_stats have angle=40
      const angle40 = await db.getAllFromIndex("climb_stats", "by-angle", 40);

      setStats(
        Object.entries(counts)
          .map(([k, v]) => `${k}: ${v}`)
          .join("\n") +
          `\n\nclimb_stats with angle=40: ${angle40.length}` +
          `\n\nSample climb_stat:\n${sampleStat}`
      );
    } catch (err) {
      setStats(`Error: ${err}`);
    }
  }

  return (
    <div className="mt-3">
      <button
        onClick={checkDb}
        className="rounded-lg bg-neutral-800 px-4 py-2 text-sm transition-colors hover:bg-neutral-700"
      >
        Check DB
      </button>
      {stats && (
        <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-neutral-900 p-3 text-xs text-neutral-300">
          {stats}
        </pre>
      )}
    </div>
  );
}

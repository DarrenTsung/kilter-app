"use client";

import { useState } from "react";
import { useAuthStore } from "@/store/authStore";
import { useSyncStore } from "@/store/syncStore";
import { login } from "@/lib/api/aurora";
import { syncAll } from "@/lib/db/sync";

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

      {isLoggedIn && (
        <section className="mt-6">
          <h2 className="text-lg font-semibold text-neutral-300">
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

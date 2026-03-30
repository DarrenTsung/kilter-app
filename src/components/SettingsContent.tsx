"use client";

import { useState, useEffect } from "react";
import { useAuthStore } from "@/store/authStore";
import { useSyncStore } from "@/store/syncStore";
import { getDB, resetDB } from "@/lib/db";
import { collectData, restoreData, type BackupPayload } from "@/lib/db/backup";
import {
  useFilterStore,
  ANGLES,
  AUTO_DISCONNECT_OPTIONS,
} from "@/store/filterStore";
import { useBleStore } from "@/store/bleStore";
import { disconnect } from "@/lib/ble/connection";

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
          <OfflineNotice />
        )}
      </section>

      <section className="mt-4">
        <h2 className="text-lg font-normal uppercase tracking-wide text-neutral-300">Board</h2>
        <AngleSelector />
      </section>

      <section className="mt-4">
        <h2 className="text-lg font-normal uppercase tracking-wide text-neutral-300">Bluetooth</h2>
        <BluetoothSection />
      </section>

      <section className="mt-4">
        <h2 className="text-lg font-normal uppercase tracking-wide text-neutral-300">
          Local Data
        </h2>
        <DataOverview />
      </section>

      <section className="mt-4">
        <h2 className="text-lg font-normal uppercase tracking-wide text-neutral-300">Backup</h2>
        <DataSection />
      </section>

      <section className="mt-4 mb-8">
        <h2 className="text-lg font-normal uppercase tracking-wide text-neutral-300">Danger Zone</h2>
        <ClearDataSection />
      </section>
    </div>
  );
}

/* ---------- Account ---------- */

function LoggedInView({
  username,
  onLogout,
}: {
  username: string | null;
  onLogout: () => void;
}) {
  // 3-step logout: idle → warning → final
  const [step, setStep] = useState<"idle" | "warning" | "final">("idle");

  return (
    <div className="mt-1 rounded-lg bg-neutral-800 py-2 px-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="label text-sm text-neutral-400">Logged in as</p>
          <p className="font-medium">{username}</p>
        </div>
        {step === "idle" && (
          <button
            onClick={() => setStep("warning")}
            className="rounded-lg bg-neutral-700 px-4 py-2 text-sm transition-colors hover:bg-neutral-600"
          >
            Log out
          </button>
        )}
      </div>

      {step === "warning" && (
        <div className="mt-3 rounded-lg bg-red-900/40 p-3">
          <p className="text-xs text-red-300">
            Aurora is offline. If you log out, you cannot log back in and
            your local activity data will become inaccessible. Make sure
            you have a backup first.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => setStep("final")}
              className="flex-1 rounded-lg bg-red-700 px-3 py-2 text-sm font-medium text-white active:bg-red-600"
            >
              I understand
            </button>
            <button
              onClick={() => setStep("idle")}
              className="rounded-lg bg-neutral-700 px-3 py-2 text-sm transition-colors hover:bg-neutral-600"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {step === "final" && (
        <div className="mt-3 rounded-lg bg-red-900/40 p-3">
          <p className="text-xs text-red-300 font-medium">
            This is permanent. Are you absolutely sure?
          </p>
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => { onLogout(); setStep("idle"); }}
              className="flex-1 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white active:bg-red-500"
            >
              Permanently log out
            </button>
            <button
              onClick={() => setStep("idle")}
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

function OfflineNotice() {
  return (
    <div className="mt-1 rounded-lg bg-neutral-800 py-2 px-3">
      <p className="text-sm text-neutral-400">
        Aurora is offline. Login is not available.
      </p>
      <p className="mt-1 text-xs text-neutral-500">
        The app operates in local-only mode using cached data.
      </p>
    </div>
  );
}

/* ---------- Data Overview (table counts) ---------- */

let cachedTableCounts: Record<string, number> = {};

function DataOverview() {
  const [tableCounts, setTableCounts] = useState<Record<string, number>>(cachedTableCounts);
  const { snapshotLoading, isSyncing, syncProgress } = useSyncStore();

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

  const isActive = snapshotLoading || isSyncing || syncProgress !== null;
  useEffect(() => {
    loadTableCounts();
    if (!isActive) return;
    const interval = setInterval(loadTableCounts, 1000);
    return () => clearInterval(interval);
  }, [isActive]); // eslint-disable-line react-hooks/exhaustive-deps

  const { lastSyncedAt } = useSyncStore();

  return (
    <div className="mt-1 rounded-lg bg-neutral-800 py-2 px-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="label text-sm text-neutral-400">Mode</p>
          <p className="text-sm font-medium">Offline (local only)</p>
        </div>
      </div>
      {lastSyncedAt && (
        <p className="mt-1 text-xs text-neutral-500">
          Last synced {new Date(lastSyncedAt).toLocaleString()}
        </p>
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
  );
}

/* ---------- Backup / Export / Import ---------- */

function DataSection() {
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [serverBackups, setServerBackups] = useState<string[] | null>(null);
  const [loadingBackups, setLoadingBackups] = useState(false);
  const [importPayload, setImportPayload] = useState<{ payload: BackupPayload; source: string } | null>(null);
  const [confirmStep, setConfirmStep] = useState<0 | 1 | 2>(0);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Auto-clear toast
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  async function handleSaveToServer() {
    setSaving(true);
    try {
      const data = await collectData();
      const resp = await fetch("/api/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!resp.ok) throw new Error(`Server error (${resp.status})`);
      const { filename } = await resp.json();
      setToast({ type: "success", message: `Saved: ${filename}` });
    } catch (err) {
      setToast({ type: "error", message: err instanceof Error ? err.message : "Save failed" });
    } finally {
      setSaving(false);
    }
  }

  async function handleDownload() {
    setDownloading(true);
    try {
      const data = await collectData();
      const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const date = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `kilter-backup-${date}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setToast({ type: "success", message: "Download started" });
    } catch (err) {
      setToast({ type: "error", message: err instanceof Error ? err.message : "Export failed" });
    } finally {
      setDownloading(false);
    }
  }

  async function handleLoadServerBackups() {
    setLoadingBackups(true);
    try {
      const resp = await fetch("/api/backup");
      if (!resp.ok) throw new Error(`Server error (${resp.status})`);
      const { backups } = await resp.json();
      setServerBackups(backups);
    } catch (err) {
      setToast({ type: "error", message: err instanceof Error ? err.message : "Failed to list backups" });
    } finally {
      setLoadingBackups(false);
    }
  }

  async function handlePickServerBackup(filename: string) {
    try {
      const resp = await fetch(`/api/backup?file=${encodeURIComponent(filename)}`);
      if (!resp.ok) throw new Error(`Server error (${resp.status})`);
      const payload: BackupPayload = await resp.json();
      setImportPayload({ payload, source: filename });
      setConfirmStep(1);
      setServerBackups(null);
    } catch (err) {
      setToast({ type: "error", message: err instanceof Error ? err.message : "Failed to load backup" });
    }
  }

  function handleFileImport() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const payload: BackupPayload = JSON.parse(text);
        if (!payload.version || !payload.indexedDB) {
          throw new Error("Invalid backup file format");
        }
        setImportPayload({ payload, source: file.name });
        setConfirmStep(1);
      } catch (err) {
        setToast({ type: "error", message: err instanceof Error ? err.message : "Invalid file" });
      }
    };
    input.click();
  }

  async function executeRestore() {
    if (!importPayload) return;
    setRestoring(true);
    try {
      await restoreData(importPayload.payload);
      // restoreData reloads the page, so this line won't execute
    } catch (err) {
      setToast({ type: "error", message: err instanceof Error ? err.message : "Restore failed" });
      setRestoring(false);
      setConfirmStep(0);
      setImportPayload(null);
    }
  }

  const storeCounts = importPayload
    ? Object.entries(importPayload.payload.indexedDB).map(([store, rows]) => ({
        store,
        count: Array.isArray(rows) ? rows.length : 0,
      }))
    : [];

  return (
    <div className="mt-1 space-y-3">
      {/* Export actions */}
      <div className="rounded-lg bg-neutral-800 py-2 px-3">
        <p className="label text-sm text-neutral-400">Export</p>
        <div className="mt-2 flex gap-2">
          <button
            onClick={handleSaveToServer}
            disabled={saving}
            className="flex-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white active:bg-blue-500 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save to Server"}
          </button>
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="flex-1 rounded-lg bg-neutral-700 px-3 py-2 text-sm font-medium text-neutral-300 active:bg-neutral-600 disabled:opacity-50"
          >
            {downloading ? "Exporting..." : "Download File"}
          </button>
        </div>
      </div>

      {/* Import actions */}
      <div className="rounded-lg bg-neutral-800 py-2 px-3">
        <p className="label text-sm text-neutral-400">Import</p>
        <div className="mt-2 flex gap-2">
          <button
            onClick={handleLoadServerBackups}
            disabled={loadingBackups}
            className="flex-1 rounded-lg bg-neutral-700 px-3 py-2 text-sm font-medium text-neutral-300 active:bg-neutral-600 disabled:opacity-50"
          >
            {loadingBackups ? "Loading..." : "From Server"}
          </button>
          <button
            onClick={handleFileImport}
            className="flex-1 rounded-lg bg-neutral-700 px-3 py-2 text-sm font-medium text-neutral-300 active:bg-neutral-600"
          >
            From File
          </button>
        </div>

        {/* Server backup list */}
        {serverBackups !== null && (
          <div className="mt-2">
            {serverBackups.length === 0 ? (
              <p className="text-xs text-neutral-500">No backups found on server.</p>
            ) : (
              <div className="space-y-1">
                {serverBackups.map((name) => (
                  <button
                    key={name}
                    onClick={() => handlePickServerBackup(name)}
                    className="block w-full rounded bg-neutral-700/50 px-2 py-1.5 text-left text-xs text-neutral-300 active:bg-neutral-600"
                  >
                    {name}
                  </button>
                ))}
              </div>
            )}
            <button
              onClick={() => setServerBackups(null)}
              className="mt-1 text-xs text-neutral-500 active:text-neutral-400"
            >
              Close
            </button>
          </div>
        )}

        {/* Restore confirmation flow (3-step) */}
        {importPayload && confirmStep >= 1 && (
          <div className="mt-3 rounded-lg bg-amber-900/30 p-3">
            <p className="text-xs font-medium text-amber-300">
              Restore from: {importPayload.source}
            </p>
            <p className="mt-1 text-xs text-amber-200/70">
              Exported {new Date(importPayload.payload.exportedAt).toLocaleString()}
            </p>
            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5">
              {storeCounts.filter(s => s.count > 0).map(({ store, count }) => (
                <div key={store} className="flex justify-between text-xs">
                  <span className="text-neutral-500">{store}</span>
                  <span className="text-neutral-400 tabular-nums">{count.toLocaleString()}</span>
                </div>
              ))}
            </div>

            {confirmStep === 1 && (
              <>
                <p className="mt-2 text-xs text-red-300">
                  This will replace ALL local data. Make sure you have a backup of your current data first.
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => setConfirmStep(2)}
                    className="flex-1 rounded-lg bg-amber-700 px-3 py-2 text-sm font-medium text-white active:bg-amber-600"
                  >
                    I understand, continue
                  </button>
                  <button
                    onClick={() => { setConfirmStep(0); setImportPayload(null); }}
                    className="rounded-lg bg-neutral-700 px-3 py-2 text-sm transition-colors hover:bg-neutral-600"
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}

            {confirmStep === 2 && (
              <>
                <p className="mt-2 text-xs text-red-300 font-medium">
                  Final confirmation. This cannot be undone.
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={executeRestore}
                    disabled={restoring}
                    className="flex-1 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white active:bg-red-500 disabled:opacity-50"
                  >
                    {restoring ? "Restoring..." : "Restore now"}
                  </button>
                  <button
                    onClick={() => { setConfirmStep(0); setImportPayload(null); }}
                    className="rounded-lg bg-neutral-700 px-3 py-2 text-sm transition-colors hover:bg-neutral-600"
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className={`rounded-lg px-3 py-2 text-sm ${toast.type === "success" ? "bg-green-900/40 text-green-300" : "bg-red-900/40 text-red-300"}`}>
          {toast.message}
        </div>
      )}
    </div>
  );
}

/* ---------- Board Angle ---------- */

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

/* ---------- Bluetooth ---------- */

function BluetoothSection() {
  const { status, deviceName } = useBleStore();
  const { autoDisconnect, setAutoDisconnect } = useFilterStore();

  return (
    <div className="mt-1 space-y-3">
      <div className="rounded-lg bg-neutral-800 py-2 px-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="label text-sm text-neutral-400">Board connection</p>
            <p className="text-sm font-medium">
              {status === "connected"
                ? deviceName ?? "Connected"
                : status === "paused"
                  ? `${deviceName ?? "Board"} (paused)`
                  : status === "disconnected"
                    ? "Not connected"
                    : status.charAt(0).toUpperCase() + status.slice(1)}
            </p>
          </div>
          {(status === "connected" || status === "paused") && (
            <button
              onClick={disconnect}
              className="rounded-lg bg-neutral-700 px-4 py-2 text-sm transition-colors hover:bg-neutral-600"
            >
              Disconnect
            </button>
          )}
        </div>
      </div>

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

/* ---------- Clear Data (triple-confirm) ---------- */

function ClearDataSection() {
  const [step, setStep] = useState<"idle" | "warning" | "typing">("idle");
  const [typed, setTyped] = useState("");
  const [clearing, setClearing] = useState(false);

  async function handleClear() {
    setClearing(true);
    try {
      await resetDB();
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.deleteDatabase("kilter-app");
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
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
      window.location.reload();
    } catch (err) {
      console.error("Failed to clear data:", err);
      setClearing(false);
    }
  }

  return (
    <div className="mt-1 rounded-lg bg-neutral-800 py-2 px-3">
      {step === "idle" && (
        <button
          onClick={() => setStep("warning")}
          className="text-sm text-red-400 active:text-red-300"
        >
          Clear Local Data
        </button>
      )}

      {step === "warning" && (
        <div>
          <p className="text-xs text-red-300">
            This will permanently delete ALL local climb data, ascents,
            circuits, and settings. With Aurora offline, this data cannot
            be recovered unless you have a backup.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => { setStep("typing"); setTyped(""); }}
              className="flex-1 rounded-lg bg-red-700 px-3 py-2 text-sm font-medium text-white active:bg-red-600"
            >
              I understand, continue
            </button>
            <button
              onClick={() => setStep("idle")}
              className="rounded-lg bg-neutral-700 px-3 py-2 text-sm transition-colors hover:bg-neutral-600"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {step === "typing" && (
        <div>
          <p className="text-xs text-red-300 font-medium">
            Type DELETE to confirm:
          </p>
          <input
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="DELETE"
            className="mt-2 block w-full rounded-lg border border-red-700 bg-neutral-900 px-3 py-2 text-sm text-white placeholder-neutral-600 focus:border-red-500 focus:outline-none"
            autoFocus
          />
          <div className="mt-2 flex gap-2">
            <button
              onClick={handleClear}
              disabled={typed !== "DELETE" || clearing}
              className="flex-1 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white active:bg-red-500 disabled:opacity-50"
            >
              {clearing ? "Clearing..." : "Permanently delete all data"}
            </button>
            <button
              onClick={() => { setStep("idle"); setTyped(""); }}
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

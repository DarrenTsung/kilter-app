"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuthStore } from "@/store/authStore";
import { useSyncStore } from "@/store/syncStore";
import { useFilterStore, difficultyToGrade, GRADES } from "@/store/filterStore";
import { getLogbookActivity, getGradeDistribution, type ActivityEntry } from "@/lib/db/queries";
import { getDB } from "@/lib/db";
import { deleteAscent, deleteBid, logAscent } from "@/lib/api/aurora";

const PAGE_SIZE = 50;

// Show labels only for these grades to avoid crowding
const LABEL_GRADES = new Set(["V0", "V2", "V4", "V6", "V8", "V10", "V12", "V14", "V16"]);

export function LogbookContent() {
  const { isLoggedIn, userId } = useAuthStore();
  const { lastSyncedAt } = useSyncStore();

  if (!isLoggedIn) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <p className="text-neutral-400">Log in from Settings to get started.</p>
      </div>
    );
  }

  if (!lastSyncedAt) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <p className="text-neutral-400">Sync your data from Settings first.</p>
      </div>
    );
  }

  return <LogbookView userId={userId!} />;
}

function LogbookView({ userId }: { userId: number }) {
  const angle = useFilterStore((s) => s.angle);
  const token = useAuthStore((s) => s.token);
  const [distribution, setDistribution] = useState<Map<number, number>>(new Map());
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [dist, entries] = await Promise.all([
        getGradeDistribution(userId, angle),
        getLogbookActivity(userId),
      ]);
      if (cancelled) return;
      setDistribution(dist);
      setActivity(entries);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [userId, angle, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);

  if (loading) {
    return (
      <div className="px-4 py-2">
        <h1 className="text-2xl font-bold">Logbook</h1>
        <p className="mt-4 text-sm text-neutral-400">Loading...</p>
      </div>
    );
  }

  // Group visible entries by day
  const visible = activity.slice(0, visibleCount);
  const dayGroups: { label: string; entries: ActivityEntry[] }[] = [];
  let currentDay = "";
  for (const entry of visible) {
    const day = formatDayLabel(entry.timestamp);
    if (day !== currentDay) {
      dayGroups.push({ label: day, entries: [] });
      currentDay = day;
    }
    dayGroups[dayGroups.length - 1].entries.push(entry);
  }

  return (
    <div className="px-4 py-2">
      <h1 className="text-2xl font-bold">Logbook</h1>
      <GradeChart distribution={distribution} />
      <div className="mt-6">
        <h2 className="text-lg font-normal text-neutral-300">Activity</h2>
        {activity.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">No activity yet.</p>
        ) : (
          <div className="mt-2">
            {dayGroups.map((group) => (
              <div key={group.label}>
                <p className="mt-4 mb-1 text-xs font-medium text-neutral-500">{group.label}</p>
                {group.entries.map((entry, i) => (
                  <ActivityRow
                    key={`${entry.type}-${entry.climb_uuid}-${entry.timestamp}-${i}`}
                    entry={entry}
                    token={token}
                    userId={userId}
                    onChanged={reload}
                  />
                ))}
              </div>
            ))}
            {visibleCount < activity.length && (
              <button
                onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                className="mt-2 w-full rounded-lg bg-neutral-800 py-2.5 text-sm font-medium text-neutral-400 active:bg-neutral-700"
              >
                Show more ({activity.length - visibleCount} remaining)
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function GradeChart({ distribution }: { distribution: Map<number, number> }) {
  const maxCount = Math.max(1, ...distribution.values());
  const hasData = [...distribution.values()].some((c) => c > 0);

  if (!hasData) {
    return <p className="mt-4 text-sm text-neutral-500">No sends logged yet.</p>;
  }

  return (
    <div className="mt-4">
      <h2 className="text-lg font-normal text-neutral-300">Sends by Grade</h2>
      <div className="mt-2 flex items-end gap-[2px]" style={{ height: 120 }}>
        {GRADES.map((g) => {
          const count = distribution.get(g.difficulty) ?? 0;
          const pct = count > 0 ? Math.max(3, (count / maxCount) * 100) : 0;
          return (
            <div key={g.difficulty} className="flex flex-1 flex-col items-center justify-end" style={{ height: "100%" }}>
              <div
                className={`w-full rounded-t ${count > 0 ? "bg-blue-500/70" : "bg-neutral-800"}`}
                style={{ height: count > 0 ? `${pct}%` : "2px" }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex gap-[2px]">
        {GRADES.map((g) => (
          <div key={g.difficulty} className="flex-1 text-center">
            {LABEL_GRADES.has(g.name) && (
              <span className="text-[8px] text-neutral-500">{g.name}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ActivityRow({ entry, token, userId, onChanged }: {
  entry: ActivityEntry;
  token: string | null;
  userId: number;
  onChanged: () => void;
}) {
  const name = entry.climb_name ?? "Unknown climb";
  const [menuOpen, setMenuOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerPos = useRef({ x: 0, y: 0 });

  const canEdit = (entry.type === "send" || entry.type === "attempt") && entry.uuid;

  function handlePointerDown(e: React.PointerEvent) {
    if (!canEdit) return;
    pointerPos.current = { x: e.clientX, y: e.clientY };
    longPressTimer.current = setTimeout(() => {
      setMenuPos(pointerPos.current);
      setMenuOpen(true);
      longPressTimer.current = null;
    }, 500);
  }

  function handlePointerUp() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  function handleContextMenu(e: React.MouseEvent) {
    if (!canEdit) return;
    e.preventDefault();
    setMenuPos({ x: e.clientX, y: e.clientY });
    setMenuOpen(true);
  }

  async function handleDelete() {
    if (!entry.uuid || !token) return;
    setDeleting(true);
    try {
      const db = await getDB();
      if (entry.type === "send") {
        await db.delete("ascents", entry.uuid);
        deleteAscent(token, entry.uuid).catch(console.error);
      } else if (entry.type === "attempt") {
        await db.delete("bids", entry.uuid);
        deleteBid(token, entry.uuid).catch(console.error);
      }
      setMenuOpen(false);
      setConfirmDelete(false);
      onChanged();
    } finally {
      setDeleting(false);
    }
  }

  const isFlash = entry.type === "send" && (entry.bid_count ?? 1) === 1;

  const rowContent = entry.type === "send" ? (
    <div
      className={`flex select-none items-center gap-2 border-b border-neutral-800/50 py-3 ${menuOpen ? "bg-neutral-800/50" : ""}`}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onContextMenu={handleContextMenu}
    >
      <svg className="shrink-0" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#a3a3a3" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
      </svg>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-white">{name}</p>
        <p className="text-[10px] text-neutral-400">
          {entry.angle}° · {isFlash ? "⚡ flash" : `${entry.bid_count} attempts`}
        </p>
      </div>
      {entry.difficulty != null && (
        <span className="shrink-0 rounded bg-blue-600/20 px-1.5 py-0.5 text-xs font-bold text-blue-400">
          {difficultyToGrade(entry.difficulty)}
        </span>
      )}
    </div>
  ) : entry.type === "attempt" ? (
    <div
      className={`flex select-none items-center gap-2 border-b border-neutral-800/30 py-1.5 ${menuOpen ? "bg-neutral-800/50" : ""}`}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onContextMenu={handleContextMenu}
    >
      <div className="w-3 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs text-neutral-500">
          Attempted {name} · {entry.bid_count ?? 1} try
        </p>
      </div>
    </div>
  ) : (
    <div className="flex select-none items-center gap-2 border-b border-neutral-800/30 py-1.5">
      <svg className="shrink-0" width="10" height="10" viewBox="0 0 24 24" fill="#525252">
        <path d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z" />
      </svg>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs text-neutral-600">
          Lit up {name}
        </p>
      </div>
    </div>
  );

  return (
    <div className="relative">
      {rowContent}

      {/* Context menu — floats over the row */}
      <AnimatePresence>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-[60]" onClick={() => { setMenuOpen(false); setConfirmDelete(false); }} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.1 }}
              className="fixed z-[61] w-36 overflow-hidden rounded-lg border border-neutral-600 bg-neutral-800 shadow-lg"
              style={{ left: menuPos.x, top: menuPos.y }}
            >
              <button
                onClick={() => { setMenuOpen(false); setEditOpen(true); }}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-neutral-300 active:bg-neutral-700"
              >
                Edit
              </button>
              {!confirmDelete ? (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="flex w-full items-center gap-2 border-t border-neutral-700 px-3 py-2.5 text-sm text-red-400 active:bg-neutral-700"
                >
                  Delete
                </button>
              ) : (
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="flex w-full items-center gap-2 border-t border-neutral-700 bg-red-600/20 px-3 py-2.5 text-sm font-medium text-red-400 active:bg-red-600/30 disabled:opacity-50"
                >
                  {deleting ? "Deleting..." : "Confirm (can't undo)"}
                </button>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Edit modal */}
      {editOpen && entry.type === "send" && (
        <EditSendModal
          entry={entry}
          token={token}
          userId={userId}
          onClose={() => setEditOpen(false)}
          onSaved={() => { setEditOpen(false); onChanged(); }}
        />
      )}
    </div>
  );
}

function EditSendModal({ entry, token, userId, onClose, onSaved }: {
  entry: ActivityEntry;
  token: string | null;
  userId: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [difficulty, setDifficulty] = useState(entry.difficulty ?? 10);
  const [bidCount, setBidCount] = useState(entry.bid_count ?? 1);
  const [quality, setQuality] = useState(entry.quality ?? 3);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!entry.uuid || !token) return;
    setSaving(true);
    try {
      // Delete old and re-save with updated values (Aurora API upserts by UUID)
      const db = await getDB();
      const existing = await db.get("ascents", entry.uuid);
      if (existing) {
        const updated = { ...existing, difficulty, bid_count: bidCount, quality };
        await db.put("ascents", updated);
      }
      // Re-save to API
      await logAscent(token, userId, {
        climb_uuid: entry.climb_uuid,
        angle: entry.angle ?? 40,
        bid_count: bidCount,
        quality,
        difficulty,
        comment: entry.comment ?? "",
      });
      onSaved();
    } catch (err) {
      console.error("Failed to save edit:", err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/60" onClick={onClose} />
      <div className="fixed inset-x-4 top-1/2 z-[61] -translate-y-1/2 rounded-2xl bg-neutral-800 p-4 shadow-xl">
        <h3 className="text-lg font-bold">Edit Send</h3>
        <p className="mt-1 text-sm text-neutral-400">{entry.climb_name}</p>

        <div className="mt-4 space-y-4">
          {/* Grade */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-neutral-400">Grade</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setDifficulty((d) => Math.max(10, d - 1))}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-700 text-sm active:bg-neutral-600"
              >−</button>
              <span className="w-12 text-center text-sm font-bold text-blue-400">{difficultyToGrade(difficulty)}</span>
              <button
                onClick={() => setDifficulty((d) => Math.min(33, d + 1))}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-700 text-sm active:bg-neutral-600"
              >+</button>
            </div>
          </div>

          {/* Attempts */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-neutral-400">Attempts</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setBidCount((b) => Math.max(1, b - 1))}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-700 text-sm active:bg-neutral-600"
              >−</button>
              <span className="w-12 text-center text-sm font-semibold">{bidCount}</span>
              <button
                onClick={() => setBidCount((b) => b + 1)}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-700 text-sm active:bg-neutral-600"
              >+</button>
            </div>
          </div>

          {/* Quality */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-neutral-400">Quality</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setQuality((q) => Math.max(0, q - 1))}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-700 text-sm active:bg-neutral-600"
              >−</button>
              <span className="w-12 text-center text-sm font-semibold">{"★".repeat(quality)}</span>
              <button
                onClick={() => setQuality((q) => Math.min(5, q + 1))}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-700 text-sm active:bg-neutral-600"
              >+</button>
            </div>
          </div>
        </div>

        <div className="mt-5 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl bg-neutral-700 py-3 text-sm font-medium text-neutral-300 active:bg-neutral-600"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 rounded-xl bg-blue-600 py-3 text-sm font-bold text-white active:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </>
  );
}

function formatDayLabel(timestamp: string): string {
  const date = new Date(timestamp.replace(" ", "T"));
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const entryDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((today.getTime() - entryDay.getTime()) / 86400000);

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return entryDay.toLocaleDateString(undefined, { weekday: "long" });
  return entryDay.toLocaleDateString(undefined, { month: "short", day: "numeric", year: entryDay.getFullYear() !== now.getFullYear() ? "numeric" : undefined });
}

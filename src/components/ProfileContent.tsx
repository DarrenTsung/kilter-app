"use client";

import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { useAuthStore } from "@/store/authStore";
import { getDB } from "@/lib/db";
import { ClimbEditor } from "./ClimbEditor";
import {
  getBlockedSet,
  invalidateBlockCache,
  getUserCircuits,
  invalidateCircuitCache,
} from "@/lib/db/queries";
import { saveTag, deleteCircuit, deleteClimb } from "@/lib/api/aurora";
import { CircuitEditModal } from "./CircuitEditModal";
import { circuitDisplayColor } from "@/lib/circuitColors";
import { parseFrames } from "@/lib/utils/frames";
import { useTabStore, type ForkData } from "@/store/tabStore";
import { useSyncStore } from "@/store/syncStore";

type ProfileView =
  | { mode: "list" }
  | { mode: "editor"; climbUuid?: string; forkFrom?: ForkData };

export function ProfileContent() {
  const { isLoggedIn, token, userId } = useAuthStore();
  const [view, setView] = useState<ProfileView>({ mode: "list" });
  const [draftRefreshKey, setDraftRefreshKey] = useState(0);
  const pendingFork = useTabStore((s) => s.pendingFork);
  const dataVersion = useSyncStore((s) => s.dataVersion);

  // Auto-open editor when a fork is pending
  useEffect(() => {
    if (pendingFork && isLoggedIn) {
      setView({ mode: "editor", forkFrom: pendingFork });
      useTabStore.getState().setPendingFork(null);
    }
  }, [pendingFork, isLoggedIn]);

  // Listen for open-draft events from ForkModal
  useEffect(() => {
    function handleOpenDraft(e: Event) {
      const uuid = (e as CustomEvent).detail as string;
      if (uuid) setView({ mode: "editor", climbUuid: uuid });
    }
    window.addEventListener("open-draft", handleOpenDraft);
    return () => window.removeEventListener("open-draft", handleOpenDraft);
  }, []);

  if (!isLoggedIn) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <p className="text-neutral-500">
          Log in via Settings to access your profile.
        </p>
      </div>
    );
  }

  if (view.mode === "editor") {
    return (
      <ClimbEditor
        key={view.climbUuid ?? view.forkFrom?.sourceUuid ?? "new"}
        initialClimbUuid={view.climbUuid}
        forkFrom={view.forkFrom}
        onBack={() => {
          setDraftRefreshKey((k) => k + 1);
          setView({ mode: "list" });
        }}
      />
    );
  }

  return (
    <div className="px-4 pt-5">
      <h1 className="text-2xl font-bold uppercase tracking-wide">Profile</h1>

      <section className="mt-4">
        <button
          onClick={() => setView({ mode: "editor" })}
          className="w-full rounded-lg bg-blue-600 py-3 text-sm font-semibold text-white active:bg-blue-500"
        >
          Create New Climb
        </button>
      </section>

      <section className="mt-4">
        <h2 className="text-lg font-normal uppercase tracking-wide text-neutral-300">
          My Drafts
        </h2>
        <DraftSection
          key={`${draftRefreshKey}-${dataVersion}`}
          userId={userId}
          onEdit={(uuid) => setView({ mode: "editor", climbUuid: uuid })}
        />
      </section>

      <section className="mt-4">
        <h2 className="text-lg font-normal uppercase tracking-wide text-neutral-300">
          Circuits
        </h2>
        <CircuitSection key={dataVersion} userId={userId} />
      </section>

      <section className="mt-4 mb-8">
        <h2 className="text-lg font-normal uppercase tracking-wide text-neutral-300">
          Blocked Climbs
        </h2>
        <BlockSection token={token} userId={userId} />
      </section>
    </div>
  );
}

function DraftSection({
  userId,
  onEdit,
}: {
  userId: number | null;
  onEdit: (uuid: string) => void;
}) {
  const { token } = useAuthStore();
  const [drafts, setDrafts] = useState<
    Array<{ uuid: string; name: string; holdCount: number }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) {
      setDrafts([]);
      setLoading(false);
      return;
    }
    async function load() {
      const db = await getDB();
      const allClimbs = await db.getAllFromIndex("climbs", "by-layout", 8);
      const userDrafts = allClimbs
        .filter(
          (c) =>
            c.setter_id === userId && c.is_draft === 1 && c.is_listed !== 0
        )
        .map((c) => ({
          uuid: c.uuid,
          name: c.name || "Untitled",
          holdCount: parseFrames(c.frames).length,
        }));
      setDrafts(userDrafts);
      setLoading(false);
    }
    load();
  }, [userId]);

  async function handleDelete(uuid: string) {
    try {
      if (token) {
        await deleteClimb(token, uuid);
      }
      const db = await getDB();
      await db.delete("climbs", uuid);
      setDrafts((prev) => prev.filter((d) => d.uuid !== uuid));
    } catch (err) {
      console.error("Failed to delete draft:", err);
    }
  }

  if (loading) {
    return (
      <div className="mt-1 rounded-lg bg-neutral-800 p-2">
        <p className="text-sm text-neutral-500">Loading...</p>
      </div>
    );
  }

  if (drafts.length === 0) {
    return (
      <div className="mt-1 rounded-lg bg-neutral-800 p-2">
        <p className="text-sm text-neutral-500">No draft climbs</p>
      </div>
    );
  }

  return (
    <div className="mt-1 divide-y divide-neutral-700 rounded-lg bg-neutral-800">
      {drafts.map((d) => (
        <div key={d.uuid} className="flex items-center gap-3 px-3 py-2">
          <button
            onClick={() => onEdit(d.uuid)}
            className="flex-1 min-w-0 text-left active:opacity-70"
          >
            <span className="block text-sm font-medium text-neutral-200 truncate">{d.name}</span>
            <span className="block text-xs text-neutral-500">{d.holdCount} holds</span>
          </button>
          {confirmingDelete === d.uuid ? (
            <div className="flex shrink-0 gap-1.5">
              <button
                onClick={() => { handleDelete(d.uuid); setConfirmingDelete(null); }}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white active:bg-red-500"
              >
                Delete
              </button>
              <button
                onClick={() => setConfirmingDelete(null)}
                className="rounded-lg bg-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-300 active:bg-neutral-600"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmingDelete(d.uuid)}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-neutral-500 active:bg-neutral-600 active:text-red-400"
            >
              <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z" clipRule="evenodd" />
              </svg>
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

// --- Moved from SettingsContent ---

function BlockSection({
  token,
  userId,
}: {
  token: string | null;
  userId: number | null;
}) {
  const [count, setCount] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    if (!userId) {
      setCount(0);
      return;
    }
    getBlockedSet(userId).then((s) => setCount(s.size));
  }, [userId]);

  async function handleClearAll() {
    if (!userId) return;
    setClearing(true);
    try {
      const db = await getDB();
      const blocked = await getBlockedSet(userId);
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
            {clearing
              ? "Clearing..."
              : `Unblock ${count} climb${count !== 1 ? "s" : ""}`}
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
    if (!userId) {
      setCircuits([]);
      return;
    }
    getUserCircuits(userId).then((rows) =>
      setCircuits(
        rows.map((r) => ({
          uuid: r.uuid,
          name: r.name,
          color: r.color,
          apiColor: r.apiColor,
          description: r.description,
          isPublic: r.is_public === 1,
        }))
      )
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
          onEdit={(c) => {
            setEditing(c);
            setListOpen(false);
          }}
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
  const [climbCounts, setClimbCounts] = useState<Map<string, number>>(
    new Map()
  );

  useEffect(() => {
    setOpen(true);
  }, []);

  useEffect(() => {
    async function loadCounts() {
      const db = await getDB();
      const counts = new Map<string, number>();
      for (const c of circuits) {
        const links = await db.getAllFromIndex(
          "circuits_climbs",
          "by-circuit",
          c.uuid
        );
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
      const links = await db.getAllFromIndex(
        "circuits_climbs",
        "by-circuit",
        uuid
      );
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
                  <span className="block text-sm font-medium text-neutral-200 truncate">
                    {c.name}
                  </span>
                  <span className="block text-xs text-neutral-500">
                    {climbCounts.get(c.uuid) ?? 0} climbs
                  </span>
                </span>
                <button
                  onClick={() => {
                    onEdit(c);
                    animateClose();
                  }}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-neutral-500 active:bg-neutral-600 active:text-neutral-200"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    className="h-3.5 w-3.5"
                  >
                    <path d="M2.695 14.763l-1.262 3.154a.5.5 0 00.65.65l3.155-1.262a4 4 0 001.343-.885L17.5 5.5a2.121 2.121 0 00-3-3L3.58 13.42a4 4 0 00-.885 1.343z" />
                  </svg>
                </button>
                <button
                  onClick={() =>
                    setConfirmingDelete(
                      confirmingDelete === c.uuid ? null : c.uuid
                    )
                  }
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-neutral-500 active:bg-neutral-600 active:text-red-400"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    className="h-3.5 w-3.5"
                  >
                    <path
                      fillRule="evenodd"
                      d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
              </div>
              {confirmingDelete === c.uuid && (
                <div className="px-3 pb-2">
                  <p className="text-xs text-neutral-400 mb-1.5 text-right">
                    Delete {climbCounts.get(c.uuid) ?? 0} climbs? Can&apos;t
                    undo.
                  </p>
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

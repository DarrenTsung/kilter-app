"use client";

import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { useAuthStore } from "@/store/authStore";
import { getUserCircuits, getCircuitMap, invalidateCircuitCache } from "@/lib/db/queries";
import { saveCircuitClimbs, createCircuit, generateUUID } from "@/lib/api/aurora";
import { getDB } from "@/lib/db";
import { CIRCUIT_COLORS, circuitDisplayColor } from "@/lib/circuitColors";

interface Props {
  climbUuid: string;
  onClose: () => void;
}

interface CircuitRow {
  uuid: string;
  name: string;
  color: string;
  checked: boolean;
}

export function CircuitPicker({ climbUuid, onClose }: Props) {
  const { token, userId } = useAuthStore();
  const [circuits, setCircuits] = useState<CircuitRow[]>([]);
  const [initialChecked, setInitialChecked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  // New circuit form state
  const [showNewForm, setShowNewForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newColor, setNewColor] = useState<string>(CIRCUIT_COLORS[0].api);
  const [newIsPublic, setNewIsPublic] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => { setOpen(true); }, []);

  const handleDone = useCallback(async () => {
    if (!token) { setOpen(false); setTimeout(onClose, 200); return; }

    // Find what changed
    const added = circuits.filter((c) => c.checked && !initialChecked.has(c.uuid));
    const removed = circuits.filter((c) => !c.checked && initialChecked.has(c.uuid));

    if (added.length === 0 && removed.length === 0) {
      setOpen(false);
      setTimeout(onClose, 200);
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const db = await getDB();

      for (const c of removed) {
        await db.delete("circuits_climbs", [c.uuid, climbUuid]);
      }

      for (const c of added) {
        const existing = await db.getAllFromIndex("circuits_climbs", "by-circuit", c.uuid);
        const climbUuids = existing.map((e) => e.climb_uuid);
        climbUuids.push(climbUuid);

        await db.put("circuits_climbs", {
          circuit_uuid: c.uuid,
          climb_uuid: climbUuid,
          position: existing.length,
        });

        // Fire API call in background
        saveCircuitClimbs(token, c.uuid, climbUuids).catch(() => { });
      }

      invalidateCircuitCache();
      setOpen(false);
      setTimeout(onClose, 200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
      setSaving(false);
    }
  }, [circuits, initialChecked, token, climbUuid, onClose]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    async function load() {
      const [userCircuits, circuitMap] = await Promise.all([
        getUserCircuits(userId!),
        getCircuitMap(),
      ]);

      if (cancelled) return;

      const climbCircuits = new Set(
        (circuitMap.get(climbUuid) ?? []).map((c) => c.uuid)
      );

      setCircuits(
        userCircuits.map((c) => ({
          uuid: c.uuid,
          name: c.name,
          color: c.color,
          checked: climbCircuits.has(c.uuid),
        }))
      );
      setInitialChecked(climbCircuits);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [climbUuid, userId]);

  function toggle(circuitUuid: string) {
    setCircuits((prev) =>
      prev.map((c) =>
        c.uuid === circuitUuid ? { ...c, checked: !c.checked } : c
      )
    );
  }

  async function handleCreate() {
    if (!newName.trim() || !token || !userId) return;
    setCreating(true);
    setError(null);

    try {
      const uuid = generateUUID();
      const db = await getDB();

      // Insert into local IndexedDB
      const now = new Date().toISOString().slice(0, 19).replace("T", " ");
      await db.put("circuits", {
        uuid,
        user_id: userId,
        name: newName.trim(),
        description: newDescription.trim(),
        color: newColor,
        is_public: newIsPublic ? 1 : 0,
        created_at: now,
        updated_at: now,
      });

      // Add to local state (checked = true so the climb gets added on Done)
      setCircuits((prev) => [
        ...prev,
        {
          uuid,
          name: newName.trim(),
          color: circuitDisplayColor(newColor),
          checked: true,
        },
      ]);

      invalidateCircuitCache();

      // Fire API call in background
      createCircuit(token, {
        uuid,
        userId,
        name: newName.trim(),
        description: newDescription.trim(),
        color: newColor,
        isPublic: newIsPublic,
      }).catch(() => { });

      // Reset form
      setShowNewForm(false);
      setNewName("");
      setNewDescription("");
      setNewColor(CIRCUIT_COLORS[0].api);
      setNewIsPublic(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create circuit");
    } finally {
      setCreating(false);
    }
  }

  return (
    createPortal(<motion.div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60"
      onClick={handleDone}
      animate={{ opacity: open ? 1 : 0 }}
      transition={{ duration: 0.15 }}
    >
      <motion.div
        className="w-full max-w-md rounded-t-2xl bg-neutral-800 p-4 pb-8"
        onClick={(e) => e.stopPropagation()}
        animate={{ y: open ? 0 : "100%" }}
        transition={{ type: "spring", stiffness: 400, damping: 35 }}
      >
        <h3 className="text-lg font-bold uppercase tracking-wide">Update Circuits</h3>

        {loading ? (
          <p className="mt-3 text-sm text-neutral-500">Loading circuits...</p>
        ) : (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {circuits.map((c) => (
              <button
                key={c.uuid}
                onClick={() => toggle(c.uuid)}
                disabled={saving}
                className="rounded-full px-3 py-1.5 text-sm font-medium text-white transition-opacity disabled:opacity-50"
                style={{
                  backgroundColor: c.color || "#666",
                  opacity: c.checked ? 1 : 0.3,
                }}
              >
                {c.name}
              </button>
            ))}
            {!showNewForm && (
              <button
                onClick={() => setShowNewForm(true)}
                disabled={saving}
                className="rounded-full bg-neutral-600 px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:bg-neutral-500 disabled:opacity-50"
              >
                +
              </button>
            )}
          </div>
        )}

        {showNewForm && (
          <div className="mt-3 space-y-3 rounded-lg bg-neutral-700/50 p-3">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Circuit name"
              className="w-full rounded-lg bg-neutral-700 px-3 py-2 text-sm text-white placeholder-neutral-400 outline-none focus:ring-1 focus:ring-blue-500"
              autoFocus
            />

            <div className="flex items-center gap-2">
              {CIRCUIT_COLORS.map((c) => (
                <button
                  key={c.api}
                  onClick={() => setNewColor(c.api)}
                  className="h-8 w-8 rounded-full transition-transform"
                  style={{
                    backgroundColor: c.display,
                    boxShadow: newColor === c.api ? `0 0 0 2px #1e1e1e, 0 0 0 4px ${c.display}` : "none",
                    transform: newColor === c.api ? "scale(1.15)" : "scale(1)",
                  }}
                  title={c.label}
                />
              ))}
            </div>

            <input
              type="text"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="Description (optional)"
              className="w-full rounded-lg bg-neutral-700 px-3 py-2 text-sm text-white placeholder-neutral-400 outline-none focus:ring-1 focus:ring-blue-500"
            />

            <label className="flex items-center gap-2 text-sm text-neutral-300">
              <input
                type="checkbox"
                checked={newIsPublic}
                onChange={(e) => setNewIsPublic(e.target.checked)}
                className="h-4 w-4 rounded accent-blue-500"
              />
              Public
            </label>

            <div className="flex gap-2">
              <button
                onClick={() => setShowNewForm(false)}
                className="flex-1 rounded-lg bg-neutral-600 py-2 text-sm font-medium text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={!newName.trim() || creating}
                className="flex-1 rounded-lg bg-blue-600 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {creating ? "Creating..." : "Create"}
              </button>
            </div>
          </div>
        )}

        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

        <button
          onClick={handleDone}
          disabled={saving}
          className="mt-4 w-full rounded-lg bg-blue-600 py-2.5 text-sm font-medium disabled:opacity-50"
        >
          {saving ? "Saving..." : "Done"}
        </button>
      </motion.div>
    </motion.div>, document.body)
  );
}

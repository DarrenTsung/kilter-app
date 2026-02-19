"use client";

import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { useAuthStore } from "@/store/authStore";
import { getUserCircuits, getCircuitMap, invalidateCircuitCache } from "@/lib/db/queries";
import { saveCircuitClimbs } from "@/lib/api/aurora";
import { getDB } from "@/lib/db";

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
        saveCircuitClimbs(token, c.uuid, climbUuids).catch(() => {});
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
        <h3 className="text-lg font-bold">Add to Circuit</h3>

        {loading ? (
          <p className="mt-3 text-sm text-neutral-500">Loading circuits...</p>
        ) : circuits.length === 0 ? (
          <p className="mt-3 text-sm text-neutral-500">
            No circuits found. Create one in the Kilter Board app first.
          </p>
        ) : (
          <div className="mt-3 flex max-h-64 flex-col gap-1.5 overflow-y-auto">
            {circuits.map((c) => (
              <button
                key={c.uuid}
                onClick={() => toggle(c.uuid)}
                disabled={saving}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-white transition-opacity disabled:opacity-50"
                style={{
                  backgroundColor: c.color || "#666",
                  opacity: c.checked ? 1 : 0.4,
                }}
              >
                <span className="flex-1 text-sm font-medium">
                  {c.name}
                </span>
                {c.checked ? (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    className="h-5 w-5"
                  >
                    <path
                      fillRule="evenodd"
                      d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
                      clipRule="evenodd"
                    />
                  </svg>
                ) : null}
              </button>
            ))}
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

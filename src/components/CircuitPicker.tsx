"use client";

import { useState, useEffect } from "react";
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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [climbUuid, userId]);

  async function toggle(circuitUuid: string, currentlyChecked: boolean) {
    if (!token || saving) return;
    setSaving(circuitUuid);
    setError(null);

    try {
      const db = await getDB();

      if (currentlyChecked) {
        // Remove climb from circuit
        await db.delete("circuits_climbs", [circuitUuid, climbUuid]);
      } else {
        // Add climb to circuit — get existing climbs first
        const existing = await db.getAllFromIndex(
          "circuits_climbs",
          "by-circuit",
          circuitUuid
        );
        const climbUuids = existing.map((e) => e.climb_uuid);
        climbUuids.push(climbUuid);

        // Save to API
        await saveCircuitClimbs(token, circuitUuid, climbUuids);

        // Save locally
        await db.put("circuits_climbs", {
          circuit_uuid: circuitUuid,
          climb_uuid: climbUuid,
          position: existing.length,
        });
      }

      invalidateCircuitCache();
      setCircuits((prev) =>
        prev.map((c) =>
          c.uuid === circuitUuid ? { ...c, checked: !currentlyChecked } : c
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update circuit");
    } finally {
      setSaving(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-t-2xl bg-neutral-800 p-4 pb-8"
        onClick={(e) => e.stopPropagation()}
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
                onClick={() => toggle(c.uuid, c.checked)}
                disabled={saving !== null}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-white transition-opacity disabled:opacity-50"
                style={{
                  backgroundColor: c.color || "#666",
                  opacity: c.checked ? 1 : 0.4,
                }}
              >
                <span className="flex-1 text-sm font-medium">
                  {c.name}
                </span>
                {saving === c.uuid ? (
                  <span className="text-xs text-white/60">...</span>
                ) : c.checked ? (
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
          onClick={onClose}
          className="mt-4 w-full rounded-lg bg-neutral-700 py-2.5 text-sm font-medium"
        >
          Done
        </button>
      </div>
    </div>
  );
}

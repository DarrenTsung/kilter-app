"use client";

import { useState, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { useAuthStore } from "@/store/authStore";
import { createCircuit } from "@/lib/api/aurora";
import { getDB } from "@/lib/db";
import { invalidateCircuitCache } from "@/lib/db/queries";
import { CIRCUIT_COLORS } from "@/lib/circuitColors";

interface CircuitData {
  uuid: string;
  name: string;
  apiColor: string;
  description: string;
  isPublic: boolean;
}

interface Props {
  circuit: CircuitData;
  onClose: () => void;
  onSaved: (updated: { name: string; apiColor: string; description: string; isPublic: boolean }) => void;
}

export function CircuitEditModal({ circuit, onClose, onSaved }: Props) {
  const { token, userId } = useAuthStore();
  const [name, setName] = useState(circuit.name);
  const [color, setColor] = useState(circuit.apiColor);
  const [description, setDescription] = useState(circuit.description);
  const [isPublic, setIsPublic] = useState(circuit.isPublic);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => { setOpen(true); }, []);

  const animateClose = useCallback(() => {
    setOpen(false);
    setTimeout(onClose, 200);
  }, [onClose]);

  async function handleSave() {
    if (!name.trim() || !userId) return;
    setSaving(true);
    setError(null);

    try {
      const db = await getDB();
      const existing = await db.get("circuits", circuit.uuid);
      const now = new Date().toISOString().slice(0, 19).replace("T", " ");

      await db.put("circuits", {
        uuid: circuit.uuid,
        user_id: userId,
        name: name.trim(),
        description: description.trim(),
        color,
        is_public: isPublic ? 1 : 0,
        created_at: existing?.created_at ?? now,
        updated_at: now,
      });

      invalidateCircuitCache();

      // Fire API call in background
      if (token) {
        createCircuit(token, {
          uuid: circuit.uuid,
          userId,
          name: name.trim(),
          description: description.trim(),
          color,
          isPublic,
        }).catch(console.error);
      }

      onSaved({ name: name.trim(), apiColor: color, description: description.trim(), isPublic });
      setOpen(false);
      setTimeout(onClose, 200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
      setSaving(false);
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
        <h3 className="text-lg font-bold uppercase tracking-wide">Edit Circuit</h3>

        <div className="mt-3 space-y-3">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Circuit name"
            className="w-full rounded-lg bg-neutral-700 px-3 py-2 text-sm text-white placeholder-neutral-400 outline-none focus:ring-1 focus:ring-blue-500"
            autoFocus
          />

          <div className="flex items-center gap-2">
            {CIRCUIT_COLORS.map((c) => (
              <button
                key={c.api}
                onClick={() => setColor(c.api)}
                className="h-8 w-8 rounded-full transition-transform"
                style={{
                  backgroundColor: c.display,
                  boxShadow: color === c.api ? `0 0 0 2px #1e1e1e, 0 0 0 4px ${c.display}` : "none",
                  transform: color === c.api ? "scale(1.15)" : "scale(1)",
                }}
                title={c.label}
              />
            ))}
          </div>

          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
            className="w-full rounded-lg bg-neutral-700 px-3 py-2 text-sm text-white placeholder-neutral-400 outline-none focus:ring-1 focus:ring-blue-500"
          />

          <label className="flex items-center gap-2 text-sm text-neutral-300">
            <input
              type="checkbox"
              checked={isPublic}
              onChange={(e) => setIsPublic(e.target.checked)}
              className="h-4 w-4 rounded accent-blue-500"
            />
            Public
          </label>
        </div>

        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

        <button
          onClick={handleSave}
          disabled={!name.trim() || saving}
          className="mt-4 w-full rounded-lg bg-blue-600 py-2.5 text-sm font-medium disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </motion.div>
    </motion.div>,
    document.body
  );
}

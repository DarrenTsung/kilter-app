"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { getDB } from "@/lib/db";
import type { ClimbResult } from "@/lib/db/queries";
import { useAuthStore } from "@/store/authStore";
import { difficultyToGrade, GRADES } from "@/store/filterStore";

export function GradeModal({ climb, initialDifficulty, onClose, onSaved }: {
  climb: ClimbResult;
  initialDifficulty: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const userId = useAuthStore((s) => s.userId);
  const [difficulty, setDifficulty] = useState(Math.round(initialDifficulty));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus({ preventScroll: true });
    return () => previousFocus?.focus({ preventScroll: true });
  }, []);

  async function saveGrade() {
    if (!userId || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const db = await getDB();
      await db.put("personal_grades", {
        user_id: userId,
        climb_uuid: climb.uuid,
        angle: climb.angle,
        difficulty,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save grade");
      setSubmitting(false);
    }
  }

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60"
      onPointerDownCapture={(event) => event.stopPropagation()}
      onClick={() => { if (!submitting) onClose(); }}
    >
      <motion.div
        role="dialog"
        ref={dialogRef}
        aria-modal="true"
        aria-labelledby="grade-modal-title"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !submitting) onClose();
          if (event.key !== "Tab") return;
          const buttons = dialogRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
          if (!buttons?.length) return;
          const first = buttons[0];
          const last = buttons[buttons.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault(); last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault(); first.focus();
          }
        }}
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 35 }}
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-neutral-800 p-5 pb-8"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="grade-modal-title" className="text-lg font-bold uppercase tracking-wide">Log Grade</h3>
        <p className="mt-1 text-sm text-neutral-400">{climb.name} &middot; {climb.angle}°</p>
        <p className="mt-3 text-sm text-neutral-400">
          Your grade opinion, saved on this device. This won’t log a send or attempt.
        </p>
        <p className="mt-4 text-xs font-medium text-neutral-400">
          Community grade: {difficultyToGrade(climb.display_difficulty)}
        </p>
        <div className="mt-2 grid grid-cols-6 gap-2" aria-label="Your grade">
          {GRADES.map((grade) => (
            <button
              key={grade.difficulty}
              onClick={() => setDifficulty(grade.difficulty)}
              aria-pressed={difficulty === grade.difficulty}
              disabled={submitting}
              className={`min-h-11 rounded-lg text-sm font-medium transition-colors ${difficulty === grade.difficulty
                ? "bg-blue-600 text-white"
                : "bg-neutral-700 text-neutral-300 hover:bg-neutral-600"}`}
            >
              {grade.name}
            </button>
          ))}
        </div>
        {error && <p role="alert" className="mt-3 text-sm text-red-400">{error}</p>}
        <div className="mt-5 flex gap-3">
          <button onClick={onClose} disabled={submitting} className="flex-1 rounded-lg bg-neutral-700 py-3 text-sm font-medium">
            Cancel
          </button>
          <button onClick={saveGrade} disabled={submitting || !userId} className="flex-1 rounded-lg bg-blue-600 py-3 text-sm font-medium disabled:opacity-50">
            {submitting ? "Saving..." : "Save Grade"}
          </button>
        </div>
      </motion.div>
    </motion.div>, document.body
  );
}

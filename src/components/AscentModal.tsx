"use client";

import { useState, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { useAuthStore } from "@/store/authStore";
import { useFilterStore, difficultyToGrade, GRADES } from "@/store/filterStore";
import { logAscent } from "@/lib/api/aurora";
import { getDB } from "@/lib/db";
import type { ClimbResult } from "@/lib/db/queries";

const TOS_KEY = "kilter-ascent-tos-accepted";

interface Props {
  climb: ClimbResult;
  onClose: () => void;
  onLogged: () => void;
}

export function AscentModal({ climb, onClose, onLogged }: Props) {
  const { token, userId } = useAuthStore();
  const angle = useFilterStore((s) => s.angle);

  const [bidCount, setBidCount] = useState(1);
  const [quality, setQuality] = useState(3);
  const [difficulty, setDifficulty] = useState(Math.round(climb.display_difficulty));
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTos, setShowTos] = useState(
    () => typeof window !== "undefined" && !localStorage.getItem(TOS_KEY)
  );
  const [open, setOpen] = useState(false);

  useEffect(() => { setOpen(true); }, []);

  const animateClose = useCallback(() => {
    setOpen(false);
    setTimeout(onClose, 200);
  }, [onClose]);

  // Nearby grades for the difficulty picker (±3 from community grade)
  const communityDiff = Math.round(climb.display_difficulty);
  const nearbyGrades = GRADES.filter(
    (g) => g.difficulty >= communityDiff - 3 && g.difficulty <= communityDiff + 3
  );

  async function handleSubmit() {
    if (!token || !userId) return;
    setSubmitting(true);
    setError(null);

    try {
      const uuid = await logAscent(token, userId, {
        climb_uuid: climb.uuid,
        angle,
        bid_count: bidCount,
        quality,
        difficulty,
        comment,
      });

      // Save to local IndexedDB
      const db = await getDB();
      const now = new Date().toLocaleString("sv").slice(0, 19);
      await db.put("ascents", {
        uuid,
        climb_uuid: climb.uuid,
        angle,
        is_mirror: 0,
        user_id: userId,
        attempt_id: 0,
        bid_count: bidCount,
        quality,
        difficulty,
        is_benchmark: 0,
        comment,
        climbed_at: now,
        created_at: now,
      });

      onLogged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to log ascent");
    } finally {
      setSubmitting(false);
    }
  }

  function acceptTos() {
    localStorage.setItem(TOS_KEY, "1");
    setShowTos(false);
  }

  return (
    createPortal(<motion.div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60"
      onClick={animateClose}
      animate={{ opacity: open ? 1 : 0 }}
      transition={{ duration: 0.15 }}
    >
      <motion.div
        className="w-full max-w-md rounded-t-2xl bg-neutral-800 p-5 pb-4"
        onClick={(e) => e.stopPropagation()}
        animate={{ y: open ? 0 : "100%" }}
        transition={{ type: "spring", stiffness: 400, damping: 35 }}
      >
        {showTos ? (
          <>
            <h3 className="text-lg font-bold">Before You Log</h3>
            <p className="mt-3 text-sm text-neutral-400">
              This will record an ascent to your Kilter Board account using an
              unofficial API. Ascents are public and visible to other users.
              Use at your own discretion.
            </p>
            <div className="mt-5 flex gap-3">
              <button
                onClick={animateClose}
                className="flex-1 rounded-lg bg-neutral-700 py-2.5 text-sm font-medium"
              >
                Cancel
              </button>
              <button
                onClick={acceptTos}
                className="flex-1 rounded-lg bg-blue-600 py-2.5 text-sm font-medium"
              >
                I Understand
              </button>
            </div>
          </>
        ) : (
          <>
            <h3 className="text-lg font-bold">Log Send</h3>
            <p className="mt-1 text-sm text-neutral-400">
              {climb.name} &middot; {difficultyToGrade(climb.display_difficulty)}
            </p>

            {/* Bid Count */}
            <div className="mt-5">
              <label className="text-xs font-medium text-neutral-400">Attempts</label>
              <div className="mt-1.5 flex items-center gap-3">
                <StepperButton
                  label="-"
                  onClick={() => setBidCount((c) => Math.max(1, c - 1))}
                  disabled={bidCount <= 1}
                />
                <span className="w-8 text-center text-lg font-bold">{bidCount}</span>
                <StepperButton
                  label="+"
                  onClick={() => setBidCount((c) => c + 1)}
                />
              </div>
            </div>

            {/* Quality */}
            <div className="mt-4">
              <label className="text-xs font-medium text-neutral-400">Quality</label>
              <div className="mt-1.5 flex gap-2">
                {[1, 2, 3].map((q) => (
                  <button
                    key={q}
                    onClick={() => setQuality(q)}
                    className={`text-2xl transition-opacity ${q <= quality ? "opacity-100" : "opacity-30"
                      }`}
                  >
                    &#9733;
                  </button>
                ))}
              </div>
            </div>

            {/* Difficulty */}
            <div className="mt-4">
              <label className="text-xs font-medium text-neutral-400">Grade</label>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {nearbyGrades.map((g) => (
                  <button
                    key={g.difficulty}
                    onClick={() => setDifficulty(g.difficulty)}
                    className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${difficulty === g.difficulty
                      ? "bg-blue-600 text-white"
                      : g.difficulty === communityDiff
                        ? "bg-neutral-600 text-neutral-200"
                        : "bg-neutral-700 text-neutral-400"
                      }`}
                  >
                    {g.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Comment */}
            <div className="mt-4">
              <label className="text-xs font-medium text-neutral-400">Comment (optional)</label>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Beta notes, thoughts..."
                rows={2}
                className="mt-1.5 w-full rounded-lg bg-neutral-700 px-3 py-2 text-sm text-white placeholder-neutral-500 outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            {error && (
              <p className="mt-3 text-sm text-red-400">{error}</p>
            )}

            {/* Actions */}
            <div className="mt-5 flex gap-3">
              <button
                onClick={animateClose}
                className="flex-1 rounded-lg bg-neutral-700 py-2.5 text-sm font-medium"
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="flex-1 rounded-lg bg-green-600 py-2.5 text-sm font-medium disabled:opacity-50"
              >
                {submitting ? "Logging..." : "Log Send"}
              </button>
            </div>
          </>
        )}
      </motion.div>
    </motion.div>, document.body)
  );
}

function StepperButton({
  label,
  onClick,
  disabled = false,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex h-9 w-9 items-center justify-center rounded-lg bg-neutral-700 text-lg font-bold transition-colors hover:bg-neutral-600 disabled:opacity-30"
    >
      {label}
    </button>
  );
}

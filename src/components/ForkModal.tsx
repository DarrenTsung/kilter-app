"use client";

import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { getForkIndex, type ForkInfo, type ClimbResult } from "@/lib/db/queries";
import { useAuthStore } from "@/store/authStore";
import { useTabStore } from "@/store/tabStore";
import { useDeckStore } from "@/store/deckStore";
import { useFilterStore } from "@/store/filterStore";
import { getDB } from "@/lib/db";

interface ForkModalProps {
  climbUuid: string;
  climbName: string;
  frames: string;
  onClose: () => void;
}

export function ForkModal({
  climbUuid,
  climbName,
  frames,
  onClose,
}: ForkModalProps) {
  const { isLoggedIn, userId } = useAuthStore();
  const angle = useFilterStore((s) => s.angle);
  const [open, setOpen] = useState(false);
  const [forks, setForks] = useState<ForkInfo[]>([]);

  useEffect(() => {
    setOpen(true);
  }, []);

  useEffect(() => {
    getForkIndex().then((index) => {
      setForks(index.get(climbUuid) ?? []);
    });
  }, [climbUuid]);

  const animateClose = useCallback(() => {
    setOpen(false);
    setTimeout(onClose, 200);
  }, [onClose]);

  function handleCreateFork() {
    useTabStore.getState().setPendingFork({
      sourceUuid: climbUuid,
      sourceName: climbName,
      frames,
    });
    useTabStore.getState().setTab("profile");
    window.history.pushState({ from: "deck" }, "", "/profile");
    animateClose();
  }

  async function handleOpenFork(fork: ForkInfo) {
    // Own draft → open in editor via profile tab
    if (fork.is_draft && fork.setter_id === userId) {
      useTabStore.getState().setTab("profile");
      // Don't push history here — openEditor() in ProfileContent handles it
      window.history.replaceState(null, "", "/profile");
      // Small delay so profile tab mounts, then trigger editor open
      setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent("open-draft", { detail: fork.uuid })
        );
      }, 50);
      animateClose();
      return;
    }

    // Published climb → open in deck
    const db = await getDB();
    const climb = await db.get("climbs", fork.uuid);
    if (!climb) return;
    const stats = await db.get("climb_stats", [fork.uuid, angle]);
    const result: ClimbResult = {
      uuid: climb.uuid,
      name: climb.name,
      setter_username: climb.setter_username,
      frames: climb.frames,
      layout_id: climb.layout_id,
      edge_left: climb.edge_left,
      edge_right: climb.edge_right,
      edge_bottom: climb.edge_bottom,
      edge_top: climb.edge_top,
      angle: stats?.angle ?? angle,
      display_difficulty: stats?.display_difficulty ?? 0,
      benchmark_difficulty: stats?.benchmark_difficulty ?? null,
      difficulty_average: stats?.difficulty_average ?? 0,
      quality_average: stats?.quality_average ?? 0,
      ascensionist_count: stats?.ascensionist_count ?? 0,
      last_climbed_at: null,
    };
    useDeckStore.getState().setDeck([result]);
    useTabStore.getState().setTab("randomizer");
    window.history.pushState({ from: "deck" }, "", "/randomizer");
    animateClose();
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
        <h3 className="text-lg font-bold uppercase tracking-wide">Forks</h3>
        <p className="mt-1 text-xs text-neutral-500">
          Variations of {climbName}
        </p>

        {forks.length > 0 ? (
          <div className="mt-3 divide-y divide-neutral-700 rounded-lg bg-neutral-700/30">
            {forks.map((f) => (
              <button
                key={f.uuid}
                onClick={() => handleOpenFork(f)}
                className="flex w-full items-center justify-between px-3 py-2.5 text-left active:bg-neutral-600/50"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-neutral-200 truncate">
                    {f.name}
                  </p>
                  <p className="text-xs text-neutral-500">
                    by {f.setter_username}
                    {f.is_draft ? " · Draft" : ""}
                  </p>
                </div>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="h-4 w-4 shrink-0 text-neutral-500"
                >
                  <path
                    fillRule="evenodd"
                    d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            ))}
          </div>
        ) : (
          <div className="mt-3 rounded-lg bg-neutral-700/30 p-3">
            <p className="text-sm text-neutral-500">No forks yet</p>
          </div>
        )}

        {isLoggedIn && (
          <button
            onClick={handleCreateFork}
            className="mt-3 w-full rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white active:bg-blue-500"
          >
            Create Fork
          </button>
        )}
      </motion.div>
    </motion.div>,
    document.body
  );
}

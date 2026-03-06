"use client";

import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { getForkIndex, type ForkInfo } from "@/lib/db/queries";
import { useAuthStore } from "@/store/authStore";
import { useTabStore } from "@/store/tabStore";

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
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
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
    history.replaceState(null, "", "/profile");
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
              <div
                key={f.uuid}
                className="flex items-center justify-between px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-neutral-200 truncate">
                    {f.name}
                  </p>
                  <p className="text-xs text-neutral-500">
                    by {f.setter_username}
                  </p>
                </div>
              </div>
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

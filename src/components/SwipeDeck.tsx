"use client";

import { useEffect, useRef } from "react";
import { motion, AnimatePresence, type PanInfo } from "framer-motion";
import { useDeckStore } from "@/store/deckStore";
import { useBleStore } from "@/store/bleStore";
import { useFilterStore } from "@/store/filterStore";
import { lightUpClimb } from "@/lib/ble/commands";
import { ClimbCard } from "./ClimbCard";

const SWIPE_THRESHOLD = 80;

const springTransition = {
  type: "spring" as const,
  stiffness: 250,
  damping: 28,
};

export function SwipeDeck() {
  const { climbs, currentIndex, next, prev, pendingDirection, swipeDirection } = useDeckStore();
  const bleStatus = useBleStore((s) => s.status);
  const autoDisconnect = useFilterStore((s) => s.autoDisconnect);
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (pendingDirection !== null) {
      useDeckStore.setState({ swipeDirection: pendingDirection, pendingDirection: null });
    }
  }, [pendingDirection]);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (bleStatus === "connected" && autoDisconnect === 0 && climbs[currentIndex]) {
      lightUpClimb(climbs[currentIndex].frames);
    }
  }, [currentIndex, bleStatus, autoDisconnect, climbs]);

  if (climbs.length === 0) return null;

  function handleDragEnd(_: unknown, info: PanInfo) {
    if (info.offset.x < -SWIPE_THRESHOLD && currentIndex < climbs.length - 1) {
      next();
    } else if (info.offset.x > SWIPE_THRESHOLD && currentIndex > 0) {
      prev();
    }
  }

  const climb = climbs[currentIndex];

  return (
    <div className="relative h-full overflow-visible pb-4">
      {/* Static card shells — peek out below, narrower */}
      <motion.div
        key={`shell2-${currentIndex}`}
        className="pointer-events-none absolute inset-x-3 bottom-0 top-0 rounded-2xl border border-neutral-500/15 bg-[#151515]"
        style={{ zIndex: 0 }}
        initial={{ y: 3 }}
        animate={{ y: 6 }}
        transition={springTransition}
      />
      <motion.div
        key={`shell1-${currentIndex}`}
        className="pointer-events-none absolute inset-x-1.5 bottom-0 top-0 rounded-2xl border border-neutral-500/20 bg-[#1a1a1a]"
        style={{ zIndex: 1 }}
        initial={{ y: 0 }}
        animate={{ y: 3 }}
        transition={springTransition}
      />

      {/* Active card — enters from behind, exits in swipe direction */}
      <AnimatePresence initial={false} custom={swipeDirection}>
        <motion.div
          key={climb.uuid}
          custom={swipeDirection}
          variants={{
            enter: { y: 3, opacity: 0 },
            center: { scale: 1, y: 0, opacity: 1 },
            exit: (d: number) => ({ x: d > 0 ? 500 : -500 }),
          }}
          initial="enter"
          animate="center"
          exit="exit"
          transition={springTransition}
          drag="x"
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.7}
          onDragEnd={handleDragEnd}
          className="absolute inset-0 cursor-grab active:cursor-grabbing"
          style={{ zIndex: 2 }}
        >
          <ClimbCard climb={climb} />
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

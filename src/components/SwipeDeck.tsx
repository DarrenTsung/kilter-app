"use client";

import { useEffect, useRef } from "react";
import {
  motion,
  animate,
  AnimatePresence,
  useMotionValue,
  useTransform,
  type PanInfo,
} from "framer-motion";
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
  const visitCounter = useRef(0);
  const prevIndexRef = useRef(currentIndex);
  const isFirstRender = useRef(true);

  // Track drag position of the active card
  const dragX = useMotionValue(0);
  const dragProgress = useTransform(dragX, [-250, 0, 250], [1, 0, 1]);

  // Shell positions interpolated from drag progress (rest → fully risen)
  const shell1Y = useTransform(dragProgress, [0, 1], [16, 0]);
  const shell1Opacity = useTransform(dragProgress, [0, 1], [0.5, 1]);
  const shell1Inset = useTransform(dragProgress, [0, 1], [6, 0]);
  const shell2Y = useTransform(dragProgress, [0, 1], [32, 16]);
  const shell2Opacity = useTransform(dragProgress, [0, 1], [0.25, 0.5]);
  const shell2Inset = useTransform(dragProgress, [0, 1], [12, 6]);
  const shell3Y = useTransform(dragProgress, [0, 1], [48, 32]);
  const shell3Opacity = useTransform(dragProgress, [0, 1], [0, 0.25]);
  const shell3Inset = useTransform(dragProgress, [0, 1], [18, 12]);

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

  function handleDrag(_: unknown, info: PanInfo) {
    dragX.set(info.offset.x);
  }

  function handleDragEnd(_: unknown, info: PanInfo) {
    if (info.offset.x < -SWIPE_THRESHOLD && currentIndex < climbs.length - 1) {
      animate(dragX, -250, { duration: 0.3 }).then(() => dragX.set(0));
      next();
    } else if (info.offset.x > SWIPE_THRESHOLD && currentIndex > 0) {
      animate(dragX, 250, { duration: 0.3 }).then(() => dragX.set(0));
      prev();
    } else {
      animate(dragX, 0, { type: "spring", stiffness: 250, damping: 28 });
    }
  }

  const climb = climbs[currentIndex];

  // Increment visit counter only on index changes so re-entering the same
  // card gets a unique key (prevents AnimatePresence from confusing exit +
  // re-enter of same uuid). Must NOT increment on every render — otherwise
  // unrelated re-renders (e.g. BLE status) cause the card to slide out.
  if (prevIndexRef.current !== currentIndex) {
    visitCounter.current++;
    prevIndexRef.current = currentIndex;
  }

  if (!climb) return null;

  return (
    <div className="relative flex h-full flex-col overflow-visible">
      <div className="relative w-full" style={{ aspectRatio: "9 / 16" }}>
        {/* Card shells — rise up as you drag the active card */}
        <motion.div
          className="pointer-events-none absolute inset-0 rounded-2xl border border-neutral-500/10 bg-[#1c1c1c]"
          style={{ zIndex: -1, y: shell3Y, opacity: shell3Opacity, left: shell3Inset, right: shell3Inset }}
        />
        <motion.div
          className="pointer-events-none absolute inset-0 rounded-2xl border border-neutral-500/15 bg-[#1c1c1c]"
          style={{ zIndex: 0, y: shell2Y, opacity: shell2Opacity, left: shell2Inset, right: shell2Inset }}
        />
        <motion.div
          className="pointer-events-none absolute inset-0 rounded-2xl border border-neutral-500/20 bg-[#1c1c1c]"
          style={{ zIndex: 1, y: shell1Y, opacity: shell1Opacity, left: shell1Inset, right: shell1Inset }}
        />

        {/* Active card — enters from behind, exits in swipe direction */}
        <AnimatePresence initial={false} custom={swipeDirection}>
          <motion.div
            key={`${climb.uuid}-${visitCounter.current}`}
            custom={swipeDirection}
            variants={{
              exit: (d: number) => ({ x: d > 0 ? 500 : -500 }),
            }}
            exit="exit"
            transition={springTransition}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.7}
            onDrag={handleDrag}
            onDragEnd={handleDragEnd}
            className="absolute inset-0 cursor-grab active:cursor-grabbing"
            style={{ zIndex: 2 }}
          >
            <motion.div
              className="h-full"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.25, delay: 0.05 }}
            >
              <ClimbCard climb={climb} />
            </motion.div>
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="flex flex-1 items-center justify-center">
        <span className="text-sm text-neutral-500">
          {currentIndex + 1} / {climbs.length}
        </span>
      </div>
    </div>
  );
}

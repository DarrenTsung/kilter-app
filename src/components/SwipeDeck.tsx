"use client";

import { useState } from "react";
import { motion, AnimatePresence, type PanInfo } from "framer-motion";
import { useDeckStore } from "@/store/deckStore";
import { ClimbCard } from "./ClimbCard";

const SWIPE_THRESHOLD = 80;

const variants = {
  enter: (direction: number) => ({
    x: direction > 0 ? -300 : 300,
    opacity: 0,
    scale: 0.95,
  }),
  center: {
    x: 0,
    opacity: 1,
    scale: 1,
  },
  exit: (direction: number) => ({
    x: direction > 0 ? 300 : -300,
    opacity: 0,
    scale: 0.95,
  }),
};

export function SwipeDeck() {
  const { climbs, currentIndex, next, prev } = useDeckStore();
  const [direction, setDirection] = useState(0);

  if (climbs.length === 0) return null;

  function handleDragEnd(_: unknown, info: PanInfo) {
    if (info.offset.x < -SWIPE_THRESHOLD && currentIndex < climbs.length - 1) {
      setDirection(-1);
      next();
    } else if (info.offset.x > SWIPE_THRESHOLD && currentIndex > 0) {
      setDirection(1);
      prev();
    }
  }

  const climb = climbs[currentIndex];

  return (
    <div className="relative h-full overflow-hidden">
      <AnimatePresence mode="popLayout" custom={direction}>
        <motion.div
          key={climb.uuid}
          custom={direction}
          variants={variants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{
            type: "spring",
            stiffness: 300,
            damping: 30,
          }}
          drag="x"
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.7}
          onDragEnd={handleDragEnd}
          className="absolute inset-0 cursor-grab active:cursor-grabbing"
        >
          <ClimbCard climb={climb} />
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

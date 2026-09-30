"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  motion,
  animate,
  useMotionValue,
  useReducedMotion,
  type PanInfo,
} from "framer-motion";
import { useDeckStore } from "@/store/deckStore";
import { useBleStore } from "@/store/bleStore";
import { lightUpClimb } from "@/lib/ble/commands";
import { useTabStore } from "@/store/tabStore";
import { ClimbCard } from "./ClimbCard";

const SWIPE_THRESHOLD = 80;
const CARD_GAP = 16;
const slideTransition = {
  type: "spring" as const,
  stiffness: 300,
  damping: 32,
};

export function SwipeDeck() {
  const { climbs, currentIndex, view, next, prev, pendingDirection } = useDeckStore();
  const bleStatus = useBleStore((s) => s.status);
  const reduceMotion = useReducedMotion();
  const viewportRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<ReturnType<typeof animate> | null>(null);
  const [cardWidth, setCardWidth] = useState(0);
  const dragX = useMotionValue(0);
  const isFirstRender = useRef(true);
  const climb = climbs[currentIndex];
  const hasClimb = Boolean(climb);
  const distance = cardWidth + CARD_GAP;

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(([entry]) => {
      setCardWidth(entry.contentRect.width);
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [hasClimb]);

  useLayoutEffect(() => {
    animationRef.current?.stop();
    animationRef.current = null;
    dragX.set(0);
  }, [currentIndex, climb?.uuid, view, cardWidth, dragX]);

  useEffect(() => () => animationRef.current?.stop(), []);

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
    if (bleStatus === "connected" && climb && useTabStore.getState().activeTab === "randomizer") {
      lightUpClimb(climb.frames, climb.uuid);
    }
  }, [currentIndex, bleStatus, climbs, climb]);

  function handleDragStart() {
    animationRef.current?.stop();
    animationRef.current = null;
  }

  function handleDragEnd(_: unknown, info: PanInfo) {
    const direction = info.offset.x < -SWIPE_THRESHOLD && currentIndex < climbs.length - 1
      ? -1
      : info.offset.x > SWIPE_THRESHOLD && currentIndex > 0 ? 1 : 0;
    const animation = animate(dragX, direction * distance,
      reduceMotion ? { duration: 0 } : slideTransition);
    animationRef.current = animation;
    animation.then(() => {
      if (animationRef.current !== animation) return;
      animationRef.current = null;
      if (direction < 0) next();
      if (direction > 0) prev();
    });
  }

  if (!climb) return null;

  return (
    <div className="relative flex h-full flex-col">
      <div ref={viewportRef} className="relative w-full overflow-hidden" style={{ aspectRatio: "9 / 16" }}>
        <motion.div
          className="absolute inset-0 cursor-grab active:cursor-grabbing"
          style={{ x: dragX }}
          drag="x"
          dragConstraints={{
            left: currentIndex < climbs.length - 1 ? -distance : 0,
            right: currentIndex > 0 ? distance : 0,
          }}
          dragElastic={0.12}
          dragMomentum={false}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          {[currentIndex - 1, currentIndex, currentIndex + 1].map((index) => {
            const card = climbs[index];
            if (!card) return null;
            const offset = index - currentIndex;
            return (
              <div
                key={card.uuid}
                className={`absolute top-0 h-full w-full ${offset !== 0 ? "pointer-events-none" : ""}`}
                style={{ left: `calc(${offset * 100}% + ${offset * CARD_GAP}px)` }}
                aria-hidden={offset !== 0}
                inert={offset !== 0}
              >
                <ClimbCard climb={card} />
              </div>
            );
          })}
        </motion.div>
      </div>
      <div className="relative flex flex-1 items-center justify-center">
        <span className="text-sm text-neutral-500">
          {currentIndex + 1} / {climbs.length}
        </span>
      </div>
    </div>
  );
}

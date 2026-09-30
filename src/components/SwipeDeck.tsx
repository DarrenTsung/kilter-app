"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  motion,
  animate,
  useMotionValue,
  useTransform,
  useReducedMotion,
  type MotionValue,
  type PanInfo,
} from "framer-motion";
import { useDeckStore } from "@/store/deckStore";
import { useBleStore } from "@/store/bleStore";
import { lightUpClimb } from "@/lib/ble/commands";
import { useTabStore } from "@/store/tabStore";
import { ClimbCard } from "./ClimbCard";
import type { ClimbResult } from "@/lib/db/queries";

const SWIPE_THRESHOLD = 80;
const FLICK_VELOCITY = 550;
const CARD_GAP = 8;
const slideTransition = {
  type: "spring" as const,
  stiffness: 360,
  damping: 38,
  mass: 0.85,
};

function CarouselCard({ climb, offset, distance, dragX, reduceMotion }: {
  climb: ClimbResult;
  offset: number;
  distance: number;
  dragX: MotionValue<number>;
  reduceMotion: boolean;
}) {
  const opacity = useTransform(
    dragX,
    [-(offset + 1) * distance, -offset * distance, (1 - offset) * distance],
    [0.15, 1, 0.15],
  );

  return (
    <motion.div
      className={`absolute top-0 h-full w-full ${offset !== 0 ? "pointer-events-none" : ""}`}
      style={{
        left: `calc(${offset * 100}% + ${offset * CARD_GAP}px)`,
        opacity: reduceMotion ? 1 : opacity,
      }}
      aria-hidden={offset !== 0}
      inert={offset !== 0}
    >
      <ClimbCard climb={climb} />
    </motion.div>
  );
}

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
    const displacement = dragX.get();
    const isFlick = Math.abs(displacement) > 40 && Math.abs(info.velocity.x) > FLICK_VELOCITY
      && displacement * info.velocity.x > 0;
    const shouldAdvance = Math.abs(displacement) > Math.min(SWIPE_THRESHOLD, cardWidth * 0.22) || isFlick;
    const direction = shouldAdvance && displacement < 0 && currentIndex < climbs.length - 1
      ? -1
      : shouldAdvance && displacement > 0 && currentIndex > 0 ? 1 : 0;
    settle(direction, info.velocity.x);
  }

  function settle(direction: number, velocity = 0) {
    const animation = animate(dragX, direction * distance,
      reduceMotion ? { duration: 0 } : {
        ...slideTransition,
        velocity: direction * velocity > 0 ? Math.max(-1400, Math.min(1400, velocity)) : 0,
      });
    animationRef.current = animation;
    animation.then(() => {
      if (animationRef.current !== animation) return;
      animationRef.current = null;
      if (direction < 0) next();
      if (direction > 0) prev();
    });
  }

  function navigate(direction: number) {
    if (animationRef.current) return;
    if (direction < 0 && currentIndex >= climbs.length - 1) return;
    if (direction > 0 && currentIndex <= 0) return;
    settle(direction);
  }

  if (!climb) return null;
  const dotCount = Math.min(5, climbs.length);
  const firstDot = Math.max(0, Math.min(currentIndex - 2, climbs.length - dotCount));

  return (
    <div className="relative flex h-full flex-col">
      <div className="relative w-full overflow-hidden rounded-2xl">
        <div ref={viewportRef} className="relative mx-3" style={{ aspectRatio: "9 / 16" }}>
          <motion.div
            className="absolute inset-0 cursor-grab active:cursor-grabbing"
            style={{ x: dragX }}
            drag="x"
            dragConstraints={{
              left: currentIndex < climbs.length - 1 ? -distance : 0,
              right: currentIndex > 0 ? distance : 0,
            }}
            dragElastic={0.06}
            dragMomentum={false}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            {[currentIndex - 1, currentIndex, currentIndex + 1].map((index) => {
              const card = climbs[index];
              if (!card) return null;
              const offset = index - currentIndex;
              return (
                <CarouselCard
                  key={card.uuid}
                  climb={card}
                  offset={offset}
                  distance={distance}
                  dragX={dragX}
                  reduceMotion={Boolean(reduceMotion)}
                />
              );
            })}
          </motion.div>
        </div>
      </div>
      <div className="relative flex flex-1 items-center justify-center gap-5" role="group" aria-label="Climb carousel">
        <button
          type="button"
          aria-label="Previous climb"
          disabled={currentIndex === 0}
          onClick={() => navigate(1)}
          className="flex h-10 w-10 items-center justify-center rounded-full text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-white active:bg-neutral-700 disabled:pointer-events-none disabled:opacity-20"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m14 6-6 6 6 6" /></svg>
        </button>
        <div className="flex min-w-20 flex-col items-center gap-2">
          <span className="text-xs tabular-nums text-neutral-400" aria-live="polite" aria-atomic="true">
            {currentIndex + 1} / {climbs.length}
          </span>
          <div className="flex h-1 items-center gap-1.5" aria-hidden="true">
            {Array.from({ length: dotCount }, (_, index) => (
              <motion.span
                key={index}
                className="block h-1 rounded-full"
                animate={{ width: index + firstDot === currentIndex ? 16 : 4, backgroundColor: index + firstDot === currentIndex ? "#a3a3a3" : "#404040" }}
                transition={{ duration: reduceMotion ? 0 : 0.2 }}
              />
            ))}
          </div>
        </div>
        <button
          type="button"
          aria-label="Next climb"
          disabled={currentIndex === climbs.length - 1}
          onClick={() => navigate(-1)}
          className="flex h-10 w-10 items-center justify-center rounded-full text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-white active:bg-neutral-700 disabled:pointer-events-none disabled:opacity-20"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m10 6 6 6-6 6" /></svg>
        </button>
      </div>
    </div>
  );
}

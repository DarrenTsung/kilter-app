"use client";

import { useEffect, useState, type ReactNode } from "react";
import { getDB } from "@/lib/db";
import { parseFrames } from "@/lib/utils/frames";
import {
  BOARD_IMAGES,
  EDGE_BOTTOM,
  EDGE_LEFT,
  EDGE_RIGHT,
  EDGE_TOP,
  KILTER_PRODUCT_ID,
  roleCategoryFromName,
  type RoleCategory,
} from "@/lib/boardGeometry";
import type { BodyHold } from "@/lib/bodyModel";

interface HoldCircle {
  x: number;
  y: number;
  color: string;
}

interface BoardState {
  holds: HoldCircle[];
  imgWidth: number;
  imgHeight: number;
}

export function BoardView({
  frames,
  className,
  overlay,
  overlayActive,
}: {
  frames: string;
  className?: string;
  /** Rendered on top of the board, inside the aspect-ratio box. */
  overlay?: ReactNode;
  /** While true the board's own pointer handling is disabled. */
  overlayActive?: boolean;
}) {
  // Try synchronous render when caches are warm
  const [state, setState] = useState<BoardState | null>(() => {
    const imgSize = imgSizeCache.get(BOARD_IMAGES[0]);
    if (placementCache && holeCache && roleColorCache && imgSize) {
      return { holds: loadHoldsSync(frames), imgWidth: imgSize.w, imgHeight: imgSize.h };
    }
    return null;
  });

  useEffect(() => {
    if (state) return; // Already rendered synchronously
    let cancelled = false;

    async function load() {
      const [holds, imgSize] = await Promise.all([
        loadHolds(frames),
        getImageSize(BOARD_IMAGES[0]),
      ]);
      if (!cancelled) {
        setState({ holds, imgWidth: imgSize.w, imgHeight: imgSize.h });
      }
    }
    load();

    return () => {
      cancelled = true;
    };
  }, [frames, state]);

  if (!state) {
    return (
      <div
        className={`flex items-center justify-center bg-neutral-900 ${className ?? ""}`}
      >
        <p className="text-sm text-neutral-600">Loading...</p>
      </div>
    );
  }

  const { holds, imgWidth, imgHeight } = state;

  // Coordinate mapping — same as climbdex drawBoard()
  const xRange = EDGE_RIGHT - EDGE_LEFT;
  const yRange = EDGE_TOP - EDGE_BOTTOM;
  const xSpacing = imgWidth / xRange;
  const ySpacing = imgHeight / yRange;
  const radius = xSpacing * 3;

  return (
    <div className={`relative border border-neutral-500/20 bg-neutral-900 ${className ?? ""}`} style={{ aspectRatio: "3 / 4" }}>
      <svg
        viewBox={`0 0 ${imgWidth} ${imgHeight}`}
        className="h-full w-full rounded-xl p-3"
        preserveAspectRatio="xMidYMid meet"
        style={overlayActive ? { pointerEvents: "none" } : undefined}
      >
        {/* Board images inside SVG for perfect coordinate alignment */}
        {BOARD_IMAGES.map((src) => (
          <image
            key={src}
            href={src}
            x="0"
            y="0"
            width={imgWidth}
            height={imgHeight}
          />
        ))}

        {/* Hold circles */}
        {holds.map((hold, i) => {
          const cx = (hold.x - EDGE_LEFT) * xSpacing;
          const cy = imgHeight - (hold.y - EDGE_BOTTOM) * ySpacing;

          return (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r={radius}
              fill={`#${hold.color}`}
              fillOpacity={0.2}
              stroke={`#${hold.color}`}
              strokeWidth={radius * 0.2}
              strokeOpacity={0.75}
            />
          );
        })}
      </svg>
      {overlay}
    </div>
  );
}

// Cache image dimensions
const imgSizeCache = new Map<string, { w: number; h: number }>();

function getImageSize(src: string): Promise<{ w: number; h: number }> {
  const cached = imgSizeCache.get(src);
  if (cached) return Promise.resolve(cached);

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const size = { w: img.naturalWidth, h: img.naturalHeight };
      imgSizeCache.set(src, size);
      resolve(size);
    };
    img.onerror = () => resolve({ w: 1000, h: 1364 }); // fallback 88:120 ratio
    img.src = src;
  });
}

// In-memory caches — loaded once, reused across all BoardView instances
let placementCache: Map<number, { hole_id: number }> | null = null;
let holeCache: Map<number, { x: number; y: number }> | null = null;
let roleColorCache: Map<number, string> | null = null;
let roleCategoryCache: Map<number, RoleCategory> | null = null;

/** Pre-warm caches so subsequent BoardView renders are synchronous. */
export async function prewarmBoardCaches() {
  await ensureCaches();
  // Also pre-warm image size
  await getImageSize(BOARD_IMAGES[0]);
}

async function ensureCaches() {
  if (placementCache && holeCache && roleColorCache && roleCategoryCache) return;

  const db = await getDB();
  const [placements, holes, roles] = await Promise.all([
    db.getAll("placements"),
    db.getAll("holes"),
    db.getAll("placement_roles"),
  ]);

  placementCache = new Map(placements.map((p) => [p.id, { hole_id: p.hole_id }]));
  holeCache = new Map(holes.map((h) => [h.id, { x: h.x, y: h.y }]));
  roleColorCache = new Map(roles.map((r) => [r.id, r.screen_color]));
  roleCategoryCache = new Map(
    roles
      .filter((r) => r.product_id === KILTER_PRODUCT_ID)
      .map((r) => [r.id, roleCategoryFromName(r.name)] as const)
      .filter((e): e is [number, RoleCategory] => e[1] !== null)
  );
}

function loadHoldsSync(frames: string): HoldCircle[] {
  const parsed = parseFrames(frames);
  const holds: HoldCircle[] = [];
  for (const frame of parsed) {
    const placement = placementCache!.get(frame.placementId);
    if (!placement) continue;
    const hole = holeCache!.get(placement.hole_id);
    if (!hole) continue;
    const color = roleColorCache!.get(frame.roleId) ?? "FFFFFF";
    holds.push({ x: hole.x, y: hole.y, color });
  }
  return holds;
}

async function loadHolds(frames: string): Promise<HoldCircle[]> {
  await ensureCaches();
  return loadHoldsSync(frames);
}

/**
 * Board geometry for the body overlay on a climb that is not being edited:
 * the climb's holds in board inches, tagged with the role the climb gave them,
 * plus the image size the overlay needs to line up with the board.
 */
export async function loadOverlayGeometry(frames: string): Promise<{
  holds: BodyHold[];
  imgWidth: number;
  imgHeight: number;
}> {
  await ensureCaches();
  const imgSize = await getImageSize(BOARD_IMAGES[0]);

  const holds: BodyHold[] = [];
  for (const frame of parseFrames(frames)) {
    const placement = placementCache!.get(frame.placementId);
    if (!placement) continue;
    const hole = holeCache!.get(placement.hole_id);
    if (!hole) continue;
    holds.push({
      placementId: frame.placementId,
      x: hole.x,
      y: hole.y,
      category: roleCategoryCache!.get(frame.roleId) ?? null,
    });
  }

  return { holds, imgWidth: imgSize.w, imgHeight: imgSize.h };
}

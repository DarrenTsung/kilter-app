"use client";

import { useEffect, useState } from "react";
import { getDB } from "@/lib/db";
import { parseFrames } from "@/lib/utils/frames";

interface HoldCircle {
  x: number;
  y: number;
  color: string;
}

// 7x10 homewall edges (product_size_id=17)
const EDGE_LEFT = -44;
const EDGE_RIGHT = 44;
const EDGE_BOTTOM = 24;
const EDGE_TOP = 144;

// Board images for 7x10 homewall (layout_id=8)
const BOARD_IMAGES = [
  "/board/product_sizes_layouts_sets/55-v2.png", // mainline (set 26)
  "/board/product_sizes_layouts_sets/56-v3.png", // auxiliary (set 27)
];

interface BoardState {
  holds: HoldCircle[];
  imgWidth: number;
  imgHeight: number;
}

export function BoardView({
  frames,
  className,
}: {
  frames: string;
  className?: string;
}) {
  const [state, setState] = useState<BoardState | null>(null);

  useEffect(() => {
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
  }, [frames]);

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
    <div className={`border border-neutral-500/20 bg-neutral-900 ${className ?? ""}`} style={{ aspectRatio: "3 / 4" }}>
      <svg
        viewBox={`0 0 ${imgWidth} ${imgHeight}`}
        className="h-full w-full rounded-xl p-3"
        preserveAspectRatio="xMidYMid meet"
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

async function loadHolds(frames: string): Promise<HoldCircle[]> {
  const db = await getDB();
  const parsed = parseFrames(frames);

  const roles = await db.getAll("placement_roles");
  const roleColorMap = new Map(roles.map((r) => [r.id, r.screen_color]));

  const holds: HoldCircle[] = [];

  for (const frame of parsed) {
    const placement = await db.get("placements", frame.placementId);
    if (!placement) continue;

    const hole = await db.get("holes", placement.hole_id);
    if (!hole) continue;

    const color = roleColorMap.get(frame.roleId) ?? "FFFFFF";
    holds.push({ x: hole.x, y: hole.y, color });
  }

  return holds;
}

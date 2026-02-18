"use client";

import { useEffect, useState } from "react";
import { getDB } from "@/lib/db";
import { parseFrames } from "@/lib/utils/frames";

interface HoldCircle {
  x: number;
  y: number;
  color: string;
}

interface BoardData {
  imageUrl: string;
  holds: HoldCircle[];
  viewBox: { width: number; height: number };
}

// 7x10 homewall edges (product_size_id=17)
const EDGE_LEFT = -44;
const EDGE_RIGHT = 44;
const EDGE_BOTTOM = 24;
const EDGE_TOP = 144;

// Board images for 7x10 homewall (layout_id=8)
// set 26 = mainline, set 27 = auxiliary
const BOARD_IMAGES = [
  "/board/product_sizes_layouts_sets/55-v2.png", // mainline
  "/board/product_sizes_layouts_sets/56-v3.png", // auxiliary
];

export function BoardView({
  frames,
  className,
}: {
  frames: string;
  className?: string;
}) {
  const [boardData, setBoardData] = useState<BoardData | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const data = await loadBoardData(frames);
      if (!cancelled) setBoardData(data);
    }
    load();

    return () => {
      cancelled = true;
    };
  }, [frames]);

  if (!boardData) {
    return (
      <div
        className={`flex items-center justify-center bg-neutral-900/50 ${className ?? ""}`}
      >
        <p className="text-sm text-neutral-600">Loading...</p>
      </div>
    );
  }

  const xRange = EDGE_RIGHT - EDGE_LEFT;
  const yRange = EDGE_TOP - EDGE_BOTTOM;
  // Use a fixed aspect ratio based on the edge coordinates
  const vbWidth = 1000;
  const vbHeight = vbWidth * (yRange / xRange);
  const xSpacing = vbWidth / xRange;
  const radius = xSpacing * 3;

  return (
    <div className={`relative overflow-hidden bg-neutral-900/50 ${className ?? ""}`}>
      {/* Board background images */}
      <div className="absolute inset-0">
        {BOARD_IMAGES.map((src) => (
          <img
            key={src}
            src={src}
            alt=""
            className="absolute inset-0 h-full w-full object-contain"
          />
        ))}
      </div>

      {/* Hold overlay */}
      <svg
        viewBox={`0 0 ${vbWidth} ${vbHeight}`}
        className="relative h-full w-full"
        preserveAspectRatio="xMidYMid meet"
      >
        {boardData.holds.map((hold, i) => {
          const cx = (hold.x - EDGE_LEFT) * xSpacing;
          const cy = vbHeight - (hold.y - EDGE_BOTTOM) * (vbHeight / yRange);

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

async function loadBoardData(frames: string): Promise<BoardData> {
  const db = await getDB();
  const parsed = parseFrames(frames);

  // Load placement roles for colors
  const roles = await db.getAll("placement_roles");
  const roleColorMap = new Map(roles.map((r) => [r.id, r.screen_color]));

  // Load placements and holes for positions
  const holds: HoldCircle[] = [];

  for (const frame of parsed) {
    const placement = await db.get("placements", frame.placementId);
    if (!placement) continue;

    const hole = await db.get("holes", placement.hole_id);
    if (!hole) continue;

    const color = roleColorMap.get(frame.roleId) ?? "FFFFFF";

    holds.push({
      x: hole.x,
      y: hole.y,
      color,
    });
  }

  return {
    imageUrl: BOARD_IMAGES[0],
    holds,
    viewBox: { width: 1000, height: 1000 },
  };
}

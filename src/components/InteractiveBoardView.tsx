"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { getDB } from "@/lib/db";

// 7x10 homewall edges (product_size_id=17)
const EDGE_LEFT = -44;
const EDGE_RIGHT = 44;
const EDGE_BOTTOM = 24;
const EDGE_TOP = 144;

const BOARD_IMAGES = [
  "/board/product_sizes_layouts_sets/55-v2.png", // mainline (set 26)
  "/board/product_sizes_layouts_sets/56-v3.png", // auxiliary (set 27)
];

const LAYOUT_ID = 8;

// Radial menu thresholds (multiplied by xSpacing to get SVG units)
const INNER_RADIUS = 13;
const OUTER_RADIUS = 24;

interface PlacementInfo {
  id: number;
  hole_id: number;
  x: number;
  y: number;
  set_id: number;
}

interface RoleInfo {
  id: number;
  name: string;
  screen_color: string;
}

export interface SelectedHold {
  placementId: number;
  roleId: number;
}

type RoleCategory = "hand" | "foot" | "start" | "finish";

const ROLE_DISPLAY: Record<RoleCategory, { label: string; color: string }> = {
  hand: { label: "Hand", color: "#00FFFF" },
  foot: { label: "Foot", color: "#FFA500" },
  start: { label: "Start", color: "#00DD00" },
  finish: { label: "Finish", color: "#FF00FF" },
};

interface InteractiveBoardViewProps {
  selectedHolds: SelectedHold[];
  ghostHolds?: SelectedHold[];
  onHoldsChange: (holds: SelectedHold[]) => void;
  onRolesLoaded?: (roles: Map<string, RoleInfo>) => void;
  className?: string;
}

export function InteractiveBoardView({
  selectedHolds,
  ghostHolds,
  onHoldsChange,
  onRolesLoaded,
  className,
}: InteractiveBoardViewProps) {
  const [placements, setPlacements] = useState<PlacementInfo[]>([]);
  const [roles, setRoles] = useState<Map<string, RoleInfo>>(new Map());
  const [roleColorMap, setRoleColorMap] = useState<Map<number, string>>(new Map());
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
  const [activeHold, setActiveHold] = useState<number | null>(null);
  const [dragCategory, setDragCategory] = useState<RoleCategory | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const xSpacingRef = useRef(1);

  useEffect(() => {
    async function load() {
      const db = await getDB();
      const [allPlacements, allHoles, allRoles] = await Promise.all([
        db.getAll("placements"),
        db.getAll("holes"),
        db.getAll("placement_roles"),
      ]);

      const holeMap = new Map(allHoles.map((h) => [h.id, h]));

      // Filter to layout 8 placements with valid holes
      const filtered: PlacementInfo[] = [];
      for (const p of allPlacements) {
        if (p.layout_id !== LAYOUT_ID) continue;
        const hole = holeMap.get(p.hole_id);
        if (!hole) continue;
        filtered.push({
          id: p.id,
          hole_id: p.hole_id,
          x: hole.x,
          y: hole.y,
          set_id: p.set_id,
        });
      }
      setPlacements(filtered);

      // Build role maps keyed by category name
      const rMap = new Map<string, RoleInfo>();
      const cMap = new Map<number, string>();
      for (const r of allRoles) {
        if (r.product_id !== 7) continue;
        const name = r.name.toLowerCase();
        // Map various names to our categories
        if (name.includes("start")) rMap.set("start", r);
        else if (name.includes("finish") || name.includes("top")) rMap.set("finish", r);
        else if (name.includes("foot") || name.includes("feet")) rMap.set("foot", r);
        else if (name.includes("hand") || name.includes("middle")) rMap.set("hand", r);
        cMap.set(r.id, r.screen_color);
      }
      setRoles(rMap);
      setRoleColorMap(cMap);
      onRolesLoaded?.(rMap);
    }
    load();
  }, [onRolesLoaded]);

  useEffect(() => {
    const img = new Image();
    img.onload = () => setImgSize({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => setImgSize({ w: 1000, h: 1364 });
    img.src = BOARD_IMAGES[0];
  }, []);

  const getSvgPoint = useCallback(
    (clientX: number, clientY: number) => {
      if (!svgRef.current) return null;
      const pt = svgRef.current.createSVGPoint();
      pt.x = clientX;
      pt.y = clientY;
      const ctm = svgRef.current.getScreenCTM();
      if (!ctm) return null;
      return pt.matrixTransform(ctm.inverse());
    },
    []
  );

  const getCategoryFromDrag = useCallback(
    (dx: number, dy: number, scale: number): RoleCategory | null => {
      const dist = Math.sqrt(dx * dx + dy * dy);
      const inner = INNER_RADIUS * scale;
      const outer = OUTER_RADIUS * scale;
      if (dist < 4 * scale) return null; // tiny dead zone just to ignore accidental micro-moves

      const isUp = dy < 0;

      if (dist <= inner) {
        return isUp ? "hand" : "foot";
      }
      if (dist <= outer) {
        return isUp ? "finish" : "start";
      }
      // Beyond outer radius — keep last selection
      return isUp ? "finish" : "start";
    },
    []
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent, placementId: number) => {
      e.preventDefault();
      e.stopPropagation();
      const svgPt = getSvgPoint(e.clientX, e.clientY);
      if (!svgPt) return;

      setDragStart({ x: svgPt.x, y: svgPt.y });

      longPressTimer.current = setTimeout(() => {
        setActiveHold(placementId);
        setDragCategory(null);
      }, 200);
    },
    [getSvgPoint]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (activeHold === null || !dragStart) return;
      const svgPt = getSvgPoint(e.clientX, e.clientY);
      if (!svgPt) return;

      const dx = svgPt.x - dragStart.x;
      const dy = svgPt.y - dragStart.y;
      const cat = getCategoryFromDrag(dx, dy, xSpacingRef.current);
      setDragCategory(cat);
    },
    [activeHold, dragStart, getSvgPoint, getCategoryFromDrag]
  );

  const handlePointerUp = useCallback(
    () => {
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }

      if (activeHold !== null && dragCategory) {
        const role = roles.get(dragCategory);
        if (role) {
          // Remove any existing selection for this placement, then add new
          const filtered = selectedHolds.filter(
            (h) => h.placementId !== activeHold
          );
          onHoldsChange([...filtered, { placementId: activeHold, roleId: role.id }]);
        }
      }

      setActiveHold(null);
      setDragCategory(null);
      setDragStart(null);
    },
    [activeHold, dragCategory, roles, selectedHolds, onHoldsChange]
  );

  const handleTap = useCallback(
    (placementId: number) => {
      // If hold is already selected, deselect it
      const existing = selectedHolds.find((h) => h.placementId === placementId);
      if (existing) {
        onHoldsChange(selectedHolds.filter((h) => h.placementId !== placementId));
      }
    },
    [selectedHolds, onHoldsChange]
  );

  if (!imgSize || placements.length === 0) {
    return (
      <div className={`flex items-center justify-center bg-neutral-900 ${className ?? ""}`}>
        <p className="text-sm text-neutral-600">Loading board...</p>
      </div>
    );
  }

  const { w: imgWidth, h: imgHeight } = imgSize;
  const xRange = EDGE_RIGHT - EDGE_LEFT;
  const yRange = EDGE_TOP - EDGE_BOTTOM;
  const xSpacing = imgWidth / xRange;
  const ySpacing = imgHeight / yRange;
  const radius = xSpacing * 3;
  xSpacingRef.current = xSpacing;

  // Build lookup for selected holds
  const selectedMap = new Map(selectedHolds.map((h) => [h.placementId, h.roleId]));

  // Find active hold position for radial menu
  const activeHoldInfo = activeHold
    ? placements.find((p) => p.id === activeHold)
    : null;

  // Magnifier lens: SVG coords of active hold
  const MAGNIFIER_RADIUS = 80; // CSS px for the lens circle
  const MAGNIFIER_ZOOM = 3;
  let magCx = 0, magCy = 0;
  if (activeHoldInfo) {
    magCx = (activeHoldInfo.x - EDGE_LEFT) * xSpacing;
    magCy = imgHeight - (activeHoldInfo.y - EDGE_BOTTOM) * ySpacing;
  }
  const magViewSize = (imgWidth / MAGNIFIER_ZOOM);

  return (
    <div
      className={`relative touch-none select-none overflow-hidden bg-neutral-900 ${className ?? ""}`}
      style={{ WebkitUserSelect: "none", WebkitTouchCallout: "none" }}
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${imgWidth} ${imgHeight}`}
        className="h-full w-full rounded-xl p-2"
        preserveAspectRatio="xMidYMid meet"
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        {/* Board images */}
        {BOARD_IMAGES.map((src) => (
          <image key={src} href={src} x="0" y="0" width={imgWidth} height={imgHeight} />
        ))}

        {/* Invisible hit targets for all holds */}
        {placements.map((p) => {
          const cx = (p.x - EDGE_LEFT) * xSpacing;
          const cy = imgHeight - (p.y - EDGE_BOTTOM) * ySpacing;

          return (
            <circle
              key={`hit-${p.id}`}
              cx={cx}
              cy={cy}
              r={radius}
              fill="transparent"
              stroke="none"
              className="cursor-pointer"
              onPointerDown={(e) => handlePointerDown(e, p.id)}
              onClick={() => handleTap(p.id)}
            />
          );
        })}

        {/* Ghost holds (forked source) — dashed ring */}
        {ghostHolds?.map((h) => {
          const p = placements.find((pl) => pl.id === h.placementId);
          if (!p) return null;
          const cx = (p.x - EDGE_LEFT) * xSpacing;
          const cy = imgHeight - (p.y - EDGE_BOTTOM) * ySpacing;
          const color = `#${roleColorMap.get(h.roleId) ?? "FFFFFF"}`;
          const hasSelected = selectedMap.has(h.placementId);

          return (
            <circle
              key={`ghost-${h.placementId}`}
              cx={cx}
              cy={cy}
              r={hasSelected ? radius * 0.8 : radius}
              fill="none"
              stroke={color}
              strokeWidth={radius * 0.2}
              strokeOpacity={0.8}
              strokeDasharray={`${radius * 0.3} ${radius * 0.15}`}
              pointerEvents="none"
            />
          );
        })}

        {/* Selected holds only */}
        {selectedHolds.map((h) => {
          // Skip active hold — we render it separately with live drag color
          if (activeHold !== null && h.placementId === activeHold) return null;
          const p = placements.find((pl) => pl.id === h.placementId);
          if (!p) return null;
          const cx = (p.x - EDGE_LEFT) * xSpacing;
          const cy = imgHeight - (p.y - EDGE_BOTTOM) * ySpacing;
          const color = `#${roleColorMap.get(h.roleId) ?? "FFFFFF"}`;

          return (
            <circle
              key={`sel-${h.placementId}`}
              cx={cx}
              cy={cy}
              r={radius}
              fill={color}
              fillOpacity={0.25}
              stroke={color}
              strokeWidth={radius * 0.2}
              strokeOpacity={0.8}
              pointerEvents="none"
            />
          );
        })}

        {/* Active hold with live drag color */}
        {activeHoldInfo && (() => {
          const cx = (activeHoldInfo.x - EDGE_LEFT) * xSpacing;
          const cy = imgHeight - (activeHoldInfo.y - EDGE_BOTTOM) * ySpacing;
          const color = dragCategory ? ROLE_DISPLAY[dragCategory].color : "#666";
          return (
            <circle
              cx={cx} cy={cy} r={radius}
              fill={color} fillOpacity={dragCategory ? 0.25 : 0}
              stroke={color} strokeWidth={radius * 0.2} strokeOpacity={0.8}
              pointerEvents="none"
            />
          );
        })()}

        {/* Radial menu overlay */}
        {activeHoldInfo && (() => {
          const cx = (activeHoldInfo.x - EDGE_LEFT) * xSpacing;
          const cy = imgHeight - (activeHoldInfo.y - EDGE_BOTTOM) * ySpacing;
          const scale = xSpacing; // scale radii to SVG units

          return (
            <g>
              {/* Dim background */}
              <circle cx={cx} cy={cy} r={OUTER_RADIUS * scale} fill="black" fillOpacity={0.5} />

              {/* Inner ring zones */}
              {/* Hand (top half of inner ring) */}
              <path
                d={describeArc(cx, cy, 4 * scale, INNER_RADIUS * scale, 180, 360)}
                fill={ROLE_DISPLAY.hand.color}
                fillOpacity={dragCategory === "hand" ? 0.7 : 0.2}
                stroke={ROLE_DISPLAY.hand.color}
                strokeWidth={2}
                strokeOpacity={0.8}
              />
              {/* Foot (bottom half of inner ring) */}
              <path
                d={describeArc(cx, cy, 4 * scale, INNER_RADIUS * scale, 0, 180)}
                fill={ROLE_DISPLAY.foot.color}
                fillOpacity={dragCategory === "foot" ? 0.7 : 0.2}
                stroke={ROLE_DISPLAY.foot.color}
                strokeWidth={2}
                strokeOpacity={0.8}
              />

              {/* Outer ring zones */}
              {/* Finish (top half of outer ring) */}
              <path
                d={describeArc(cx, cy, INNER_RADIUS * scale, OUTER_RADIUS * scale, 180, 360)}
                fill={ROLE_DISPLAY.finish.color}
                fillOpacity={dragCategory === "finish" ? 0.7 : 0.2}
                stroke={ROLE_DISPLAY.finish.color}
                strokeWidth={2}
                strokeOpacity={0.8}
              />
              {/* Start (bottom half of outer ring) */}
              <path
                d={describeArc(cx, cy, INNER_RADIUS * scale, OUTER_RADIUS * scale, 0, 180)}
                fill={ROLE_DISPLAY.start.color}
                fillOpacity={dragCategory === "start" ? 0.7 : 0.2}
                stroke={ROLE_DISPLAY.start.color}
                strokeWidth={2}
                strokeOpacity={0.8}
              />

              {/* Labels */}
              {([
                ["HAND", cy - INNER_RADIUS * 0.7 * scale],
                ["FOOT", cy + INNER_RADIUS * 0.7 * scale],
                ["FINISH", cy - (INNER_RADIUS + (OUTER_RADIUS - INNER_RADIUS) / 2) * scale],
                ["START", cy + (INNER_RADIUS + (OUTER_RADIUS - INNER_RADIUS) / 2) * scale],
              ] as const).map(([label, y]) => (
                <text key={label} x={cx} y={y} textAnchor="middle" dominantBaseline="central" fill="white" fontSize={INNER_RADIUS * 0.25 * scale} fontWeight="bold" fontFamily='-apple-system, "SF Pro Display", "SF Pro Text", system-ui, sans-serif'>
                  {label}
                </text>
              ))}
            </g>
          );
        })()}
      </svg>

      {/* Magnifier lens at bottom center */}
      {activeHoldInfo && (
        <div
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border-2 border-neutral-500 overflow-hidden shadow-lg shadow-black/50 bg-neutral-900"
          style={{ width: MAGNIFIER_RADIUS * 2, height: MAGNIFIER_RADIUS * 2 }}
        >
          <svg
            viewBox={`${magCx - magViewSize / 2} ${magCy - magViewSize / 2} ${magViewSize} ${magViewSize}`}
            className="h-full w-full"
            preserveAspectRatio="xMidYMid meet"
          >
            {/* Board images */}
            {BOARD_IMAGES.map((src) => (
              <image key={src} href={src} x="0" y="0" width={imgWidth} height={imgHeight} />
            ))}

            {/* Selected holds */}
            {selectedHolds.map((h) => {
              const p = placements.find((pl) => pl.id === h.placementId);
              if (!p) return null;
              const hcx = (p.x - EDGE_LEFT) * xSpacing;
              const hcy = imgHeight - (p.y - EDGE_BOTTOM) * ySpacing;
              const color = `#${roleColorMap.get(h.roleId) ?? "FFFFFF"}`;
              return (
                <circle
                  key={`mag-${h.placementId}`}
                  cx={hcx} cy={hcy} r={radius}
                  fill={color} fillOpacity={0.25}
                  stroke={color} strokeWidth={radius * 0.2} strokeOpacity={0.8}
                />
              );
            })}

            {/* Active hold with current drag role color */}
            <circle
              cx={magCx} cy={magCy} r={radius}
              fill={dragCategory ? ROLE_DISPLAY[dragCategory].color : "transparent"}
              fillOpacity={dragCategory ? 0.25 : 0}
              stroke={dragCategory ? ROLE_DISPLAY[dragCategory].color : "white"}
              strokeWidth={radius * 0.2}
              strokeOpacity={0.8}
            />
            {/* Crosshair ring */}
            <circle
              cx={magCx} cy={magCy} r={radius * 1.5}
              fill="none" stroke="white" strokeWidth={4} strokeOpacity={0.8}
            />
          </svg>
        </div>
      )}
    </div>
  );
}

/** Build an SVG arc path for a half-annulus (semicircular ring segment). */
function describeArc(
  cx: number,
  cy: number,
  innerR: number,
  outerR: number,
  startAngle: number,
  endAngle: number
): string {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const s = toRad(startAngle);
  const e = toRad(endAngle);

  const outerStartX = cx + outerR * Math.cos(s);
  const outerStartY = cy + outerR * Math.sin(s);
  const outerEndX = cx + outerR * Math.cos(e);
  const outerEndY = cy + outerR * Math.sin(e);
  const innerStartX = cx + innerR * Math.cos(e);
  const innerStartY = cy + innerR * Math.sin(e);
  const innerEndX = cx + innerR * Math.cos(s);
  const innerEndY = cy + innerR * Math.sin(s);

  const largeArc = endAngle - startAngle > 180 ? 1 : 0;

  return [
    `M ${outerStartX} ${outerStartY}`,
    `A ${outerR} ${outerR} 0 ${largeArc} 1 ${outerEndX} ${outerEndY}`,
    `L ${innerStartX} ${innerStartY}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 0 ${innerEndX} ${innerEndY}`,
    "Z",
  ].join(" ");
}

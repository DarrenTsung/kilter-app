"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { getDB } from "@/lib/db";
import { useSyncStore } from "@/store/syncStore";
import { useFilterStore } from "@/store/filterStore";
import {
  loadHoldStats,
  summarizeHold,
  ROLE_COLORS,
  ROLE_LABELS,
  type HoldStatsFile,
} from "@/lib/holdStats";
import { HoldStatsPanel } from "./HoldStatsPanel";

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

// Magnifier shown inside the hold tooltip (board units of the SVG viewBox)
const MAGNIFIER_ZOOM = 4;

// Hold tooltip box, used to decide whether it fits above the radial menu
const TOOLTIP_WIDTH = 248;
const TOOLTIP_HEIGHT = 230;
const TOOLTIP_GAP = 6;

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
  hand: { label: ROLE_LABELS.hand, color: ROLE_COLORS.hand },
  foot: { label: ROLE_LABELS.foot, color: ROLE_COLORS.foot },
  start: { label: ROLE_LABELS.start, color: ROLE_COLORS.start },
  finish: { label: ROLE_LABELS.finish, color: ROLE_COLORS.finish },
};

interface InteractiveBoardViewProps {
  selectedHolds: SelectedHold[];
  ghostHolds?: SelectedHold[];
  onHoldsChange: (holds: SelectedHold[]) => void;
  onRolesLoaded?: (roles: Map<string, RoleInfo>) => void;
  /** Show per-hold usage stats while picking a role. */
  showHoldStats?: boolean;
  className?: string;
}

export function InteractiveBoardView({
  selectedHolds,
  ghostHolds,
  onHoldsChange,
  onRolesLoaded,
  showHoldStats,
  className,
}: InteractiveBoardViewProps) {
  const [placements, setPlacements] = useState<PlacementInfo[]>([]);
  const [roles, setRoles] = useState<Map<string, RoleInfo>>(new Map());
  const [roleColorMap, setRoleColorMap] = useState<Map<number, string>>(new Map());
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
  const [activeHold, setActiveHold] = useState<number | null>(null);
  const [dragCategory, setDragCategory] = useState<RoleCategory | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  // undefined = not requested yet, null = unavailable
  const [holdStats, setHoldStats] = useState<HoldStatsFile | null | undefined>(undefined);
  const angle = useFilterStore((s) => s.angle);
  // Re-read board geometry whenever the local database finishes loading.
  const dataVersion = useSyncStore((s) => s.dataVersion);
  const snapshotLoading = useSyncStore((s) => s.snapshotLoading);
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const xSpacingRef = useRef(1);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
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

        if (cancelled) return;
        setPlacements(filtered);
        setRoles(rMap);
        setRoleColorMap(cMap);
        onRolesLoaded?.(rMap);
      } catch (err) {
        console.error("[board] Failed to load board geometry:", err);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [onRolesLoaded, dataVersion]);

  useEffect(() => {
    if (!showHoldStats) return;
    let cancelled = false;
    loadHoldStats().then((file) => {
      if (!cancelled) setHoldStats(file);
    });
    return () => {
      cancelled = true;
    };
  }, [showHoldStats]);

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
        <p className="px-6 text-center text-sm text-neutral-600">
          {snapshotLoading
            ? "Loading board..."
            : "Board data unavailable. Climb data has not been loaded on this device."}
        </p>
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

  // Radial menu overlay geometry: convert the active hold's SVG position to
  // container-relative CSS pixels so the menu can render above everything and
  // never gets clipped by the SVG viewBox.
  let radialGeo: {
    left: number;
    top: number;
    scale: number;
    containerW: number;
    containerH: number;
  } | null = null;
  let magGeo: { cx: number; cy: number; viewSize: number } | null = null;
  if (activeHoldInfo) {
    const cx = (activeHoldInfo.x - EDGE_LEFT) * xSpacing;
    const cy = imgHeight - (activeHoldInfo.y - EDGE_BOTTOM) * ySpacing;
    magGeo = { cx, cy, viewSize: imgWidth / MAGNIFIER_ZOOM };
    const svg = svgRef.current;
    const container = containerRef.current;
    const ctm = svg?.getScreenCTM?.();
    if (svg && container && ctm) {
      const pt = svg.createSVGPoint();
      pt.x = cx;
      pt.y = cy;
      const screen = pt.matrixTransform(ctm);
      const rect = container.getBoundingClientRect();
      radialGeo = {
        left: screen.x - rect.left,
        top: screen.y - rect.top,
        scale: ctm.a,
        containerW: rect.width,
        containerH: rect.height,
      };
    }
  }

  // Per-hold usage stats for the hold being edited.
  const statsLoading = !!showHoldStats && holdStats === undefined;
  const holdSummary =
    showHoldStats && holdStats && activeHold !== null
      ? summarizeHold(holdStats, angle, activeHold, placements.length)
      : null;

  return (
    <div
      ref={containerRef}
      className={`relative touch-none select-none bg-neutral-900 ${className ?? ""}`}
      style={{ WebkitUserSelect: "none", WebkitTouchCallout: "none" }}
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${imgWidth} ${imgHeight}`}
        className="h-full w-full rounded-xl px-2 pb-2 pt-14"
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
              data-hold={p.id}
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

        {/* Ghost rings — dashed outlines showing diff from forked source */}
        {ghostHolds && (() => {
          const ghostMap = new Map(ghostHolds.map((h) => [h.placementId, h.roleId]));
          return (
            <>
              {/* Removed or role-changed holds from source */}
              {ghostHolds.map((h) => {
                const selectedRoleId = selectedMap.get(h.placementId);
                if (selectedRoleId === h.roleId) return null;

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
                    r={hasSelected ? radius * 1.2 : radius}
                    fill="none"
                    stroke={color}
                    strokeWidth={radius * 0.2}
                    strokeOpacity={0.64}
                    strokeDasharray={`${radius * 0.3} ${radius * 0.15}`}
                    pointerEvents="none"
                  />
                );
              })}
              {/* Added holds not in source */}
              {selectedHolds.map((h) => {
                if (ghostMap.has(h.placementId)) return null;

                const p = placements.find((pl) => pl.id === h.placementId);
                if (!p) return null;
                const cx = (p.x - EDGE_LEFT) * xSpacing;
                const cy = imgHeight - (p.y - EDGE_BOTTOM) * ySpacing;
                const color = `#${roleColorMap.get(h.roleId) ?? "FFFFFF"}`;

                return (
                  <circle
                    key={`ghost-add-${h.placementId}`}
                    cx={cx}
                    cy={cy}
                    r={radius * 1.2}
                    fill="none"
                    stroke={color}
                    strokeWidth={radius * 0.2}
                    strokeOpacity={0.64}
                    strokeDasharray={`${radius * 0.3} ${radius * 0.15}`}
                    pointerEvents="none"
                  />
                );
              })}
            </>
          );
        })()}

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

      </svg>

      {/* Radial menu overlay — rendered above the SVG so it never clips */}
      {activeHoldInfo && radialGeo && (() => {
        const outer = OUTER_RADIUS * xSpacing * radialGeo.scale;
        const inner = INNER_RADIUS * xSpacing * radialGeo.scale;
        const dead = 4 * xSpacing * radialGeo.scale;
        const stroke = 2 * radialGeo.scale;
        const font = INNER_RADIUS * 0.25 * xSpacing * radialGeo.scale;
        const c = outer;

        // Keep the tooltip on screen: above the menu normally, below it when
        // the hold sits too close to the top. If neither side has room (short
        // boards) the roomier side wins so overflow is minimal.
        const spaceAbove = radialGeo.top - outer - TOOLTIP_GAP;
        const spaceBelow =
          radialGeo.containerH - radialGeo.top - outer - TOOLTIP_GAP;
        const placeBelow =
          spaceAbove < TOOLTIP_HEIGHT && spaceBelow > spaceAbove;
        const tooltipTop = placeBelow
          ? outer + TOOLTIP_GAP
          : -(outer + TOOLTIP_GAP);
        const half = TOOLTIP_WIDTH / 2 + 4;
        const maxCenter = Math.max(half, radialGeo.containerW - half);
        const center = Math.min(Math.max(radialGeo.left, half), maxCenter);
        const tooltipLeft = center - radialGeo.left;

        return (
          <div
            className="pointer-events-none absolute z-50"
            style={{ left: radialGeo.left, top: radialGeo.top }}
          >
            <svg
              width={outer * 2}
              height={outer * 2}
              viewBox={`0 0 ${outer * 2} ${outer * 2}`}
              style={{ position: "absolute", left: -outer, top: -outer, overflow: "visible" }}
            >
              {/* Dim background */}
              <circle cx={c} cy={c} r={outer} fill="black" fillOpacity={0.5} />

              {/* Hand (top half of inner ring) */}
              <path
                d={describeArc(c, c, dead, inner, 180, 360)}
                fill={ROLE_DISPLAY.hand.color}
                fillOpacity={dragCategory === "hand" ? 0.7 : 0.2}
                stroke={ROLE_DISPLAY.hand.color}
                strokeWidth={stroke}
                strokeOpacity={0.8}
              />
              {/* Foot (bottom half of inner ring) */}
              <path
                d={describeArc(c, c, dead, inner, 0, 180)}
                fill={ROLE_DISPLAY.foot.color}
                fillOpacity={dragCategory === "foot" ? 0.7 : 0.2}
                stroke={ROLE_DISPLAY.foot.color}
                strokeWidth={stroke}
                strokeOpacity={0.8}
              />

              {/* Finish (top half of outer ring) */}
              <path
                d={describeArc(c, c, inner, outer, 180, 360)}
                fill={ROLE_DISPLAY.finish.color}
                fillOpacity={dragCategory === "finish" ? 0.7 : 0.2}
                stroke={ROLE_DISPLAY.finish.color}
                strokeWidth={stroke}
                strokeOpacity={0.8}
              />
              {/* Start (bottom half of outer ring) */}
              <path
                d={describeArc(c, c, inner, outer, 0, 180)}
                fill={ROLE_DISPLAY.start.color}
                fillOpacity={dragCategory === "start" ? 0.7 : 0.2}
                stroke={ROLE_DISPLAY.start.color}
                strokeWidth={stroke}
                strokeOpacity={0.8}
              />

              {/* Labels */}
              {([
                ["HAND", c - inner * 0.7],
                ["FOOT", c + inner * 0.7],
                ["FINISH", c - (inner + (outer - inner) / 2)],
                ["START", c + (inner + (outer - inner) / 2)],
              ] as const).map(([label, y]) => (
                <text key={label} x={c} y={y} textAnchor="middle" dominantBaseline="central" fill="white" fontSize={font} fontWeight="bold" fontFamily='-apple-system, "SF Pro Display", "SF Pro Text", system-ui, sans-serif'>
                  {label}
                </text>
              ))}
            </svg>

            {/* Hold stats tooltip */}
            {showHoldStats && magGeo && (
              <div
                className="absolute"
                style={{
                  left: tooltipLeft,
                  top: tooltipTop,
                  transform: placeBelow ? "translate(-50%, 0)" : "translate(-50%, -100%)",
                }}
              >
                <HoldStatsPanel
                  angle={angle}
                  loading={statsLoading}
                  summary={holdSummary}
                  magnifier={
                    <svg
                      viewBox={`${magGeo.cx - magGeo.viewSize / 2} ${magGeo.cy - magGeo.viewSize / 2} ${magGeo.viewSize} ${magGeo.viewSize}`}
                      className="h-full w-full"
                      preserveAspectRatio="xMidYMid meet"
                    >
                      {BOARD_IMAGES.map((src) => (
                        <image key={src} href={src} x="0" y="0" width={imgWidth} height={imgHeight} />
                      ))}

                      {selectedHolds.map((h) => {
                        if (h.placementId === activeHoldInfo.id) return null;
                        const p = placements.find((pl) => pl.id === h.placementId);
                        if (!p) return null;
                        const hx = (p.x - EDGE_LEFT) * xSpacing;
                        const hy = imgHeight - (p.y - EDGE_BOTTOM) * ySpacing;
                        const color = `#${roleColorMap.get(h.roleId) ?? "FFFFFF"}`;
                        return (
                          <circle
                            key={`mag-${h.placementId}`}
                            cx={hx} cy={hy} r={radius}
                            fill={color} fillOpacity={0.25}
                            stroke={color} strokeWidth={radius * 0.2} strokeOpacity={0.8}
                          />
                        );
                      })}

                      {/* Active hold in its live drag colour */}
                      <circle
                        cx={magGeo.cx} cy={magGeo.cy} r={radius}
                        fill={dragCategory ? ROLE_DISPLAY[dragCategory].color : "transparent"}
                        fillOpacity={dragCategory ? 0.25 : 0}
                        stroke={dragCategory ? ROLE_DISPLAY[dragCategory].color : "white"}
                        strokeWidth={radius * 0.2}
                        strokeOpacity={0.9}
                      />
                      <circle
                        cx={magGeo.cx} cy={magGeo.cy} r={radius * 1.6}
                        fill="none" stroke="white" strokeWidth={2} strokeOpacity={0.45}
                      />
                    </svg>
                  }
                />
              </div>
            )}
          </div>
        );
      })()}
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

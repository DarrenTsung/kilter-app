"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  APE_MAX,
  APE_MIN,
  HEIGHT_MAX,
  HEIGHT_MIN,
  LIMB_IDS,
  autoAssign,
  formatHeight,
  limbLabel,
  nearestReachableHold,
  resolveBody,
  skeleton,
  type BoardBounds,
  type BodyHold,
  type BodyPose,
  type LimbId,
  type LimbTargets,
  type Point,
  type SavedPose,
} from "@/lib/bodyModel";
import { generateUUID } from "@/lib/api/uuid";
import { loadPoses, persistPoses } from "@/lib/db/poses";
import { useClimberStore } from "@/store/climberStore";

const LIMB_IDS_ALL: LimbId[] = LIMB_IDS;

export interface BodyPositionerProps {
  /** Holds the climber can grab, in board inches. */
  holds: BodyHold[];
  /** Climb these poses belong to (draft uuid before it is published). */
  climbUuid: string;
  board: BoardBounds;
  /** Board image size in SVG units, matching InteractiveBoardView's viewBox. */
  imgWidth: number;
  imgHeight: number;
  /** SVG units per inch, horizontally and vertically. */
  xSpacing: number;
  ySpacing: number;
  /** Called when the user closes the body overlay. */
  onClose: () => void;
  className?: string;
}

type Drag =
  | { kind: "body"; grab: Point }
  | { kind: "limb"; id: LimbId; point: Point }
  | null;

/** Where the body sits; size comes from the active climber template. */
interface Stance {
  pelvis: Point;
  lean: number;
}

const DEFAULT_LEAN = 0;

/** green (unloaded) -> amber -> red (carrying most of the body weight) */
function loadColor(load: number): string {
  const t = Math.max(0, Math.min(1, load / 0.55));
  const hue = 140 * (1 - t);
  return `hsl(${hue.toFixed(0)}, 85%, 55%)`;
}

function initialStance(board: BoardBounds, height: number): Stance {
  return {
    pelvis: {
      x: (board.left + board.right) / 2,
      y: (board.bottom + board.top) / 2 - height * 0.18,
    },
    lean: DEFAULT_LEAN,
  };
}

export function BodyPositioner({
  holds,
  climbUuid,
  board,
  imgWidth,
  imgHeight,
  xSpacing,
  ySpacing,
  onClose,
  className,
}: BodyPositionerProps) {
  const templates = useClimberStore((s) => s.templates);
  const activeId = useClimberStore((s) => s.activeId);
  const setActiveClimber = useClimberStore((s) => s.setActive);
  const updateTemplate = useClimberStore((s) => s.updateTemplate);
  const climber = templates.find((t) => t.id === activeId) ?? templates[0];

  const [stance, setStance] = useState<Stance>(() =>
    initialStance(board, climber?.height ?? 67)
  );
  const [targets, setTargets] = useState<LimbTargets>(() =>
    autoAssign({ ...initialStance(board, climber?.height ?? 67), height: climber?.height ?? 67, ape: climber?.ape ?? 0 }, holds)
  );
  const [drag, setDrag] = useState<Drag>(null);
  const [showSize, setShowSize] = useState(false);
  const [poses, setPoses] = useState<SavedPose[]>([]);
  const [loadedPoseId, setLoadedPoseId] = useState<string | null>(null);
  const [confirmPoseId, setConfirmPoseId] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Size always comes from the active climber, so switching template resizes
  // the figure without touching where the body is standing.
  const pose: BodyPose = useMemo(
    () => ({ ...stance, height: climber?.height ?? 67, ape: climber?.ape ?? 0 }),
    [stance, climber?.height, climber?.ape]
  );

  const resolved = useMemo(() => resolveBody(pose, targets, holds), [pose, targets, holds]);
  const sk = useMemo(() => skeleton(pose), [pose]);

  // Poses for this climb, filtered to the climber currently selected.
  useEffect(() => {
    if (!climbUuid) return;
    let cancelled = false;
    loadPoses(climbUuid).then((saved) => {
      if (!cancelled) setPoses(saved);
    });
    return () => {
      cancelled = true;
    };
  }, [climbUuid]);

  const climbPoses = useMemo(
    () => poses.filter((p) => p.templateId === climber?.id),
    [poses, climber?.id]
  );

  const toSvg = useCallback(
    (p: Point) => ({
      x: (p.x - board.left) * xSpacing,
      y: imgHeight - (p.y - board.bottom) * ySpacing,
    }),
    [board.left, board.bottom, xSpacing, ySpacing, imgHeight]
  );

  const toBoard = useCallback(
    (clientX: number, clientY: number): Point | null => {
      const svg = svgRef.current;
      if (!svg) return null;
      const ctm = svg.getScreenCTM();
      if (!ctm) return null;
      const pt = svg.createSVGPoint();
      pt.x = clientX;
      pt.y = clientY;
      const local = pt.matrixTransform(ctm.inverse());
      return {
        x: local.x / xSpacing + board.left,
        y: (imgHeight - local.y) / ySpacing + board.bottom,
      };
    },
    [board.left, board.bottom, xSpacing, ySpacing, imgHeight]
  );

  /** Give any limb that has no target a chance to grab something nearby. */
  const regrab = useCallback(
    (nextPose: BodyPose, current: LimbTargets): LimbTargets => {
      const assigned = autoAssign(nextPose, holds);
      const out = { ...current };
      for (const id of LIMB_IDS_ALL) {
        if (out[id].kind === "free" && assigned[id].kind === "hold") {
          out[id] = assigned[id];
        }
      }
      return out;
    },
    [holds]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent, limb: LimbId | null) => {
      e.preventDefault();
      e.stopPropagation();
      const point = toBoard(e.clientX, e.clientY);
      if (!point) return;
      e.currentTarget.setPointerCapture?.(e.pointerId);
      if (limb) {
        setDrag({ kind: "limb", id: limb, point });
      } else {
        setDrag({
          kind: "body",
          grab: { x: point.x - stance.pelvis.x, y: point.y - stance.pelvis.y },
        });
      }
    },
    [stance.pelvis.x, stance.pelvis.y, toBoard]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!drag) return;
      const point = toBoard(e.clientX, e.clientY);
      if (!point) return;
      if (drag.kind === "body") {
        const pelvis = { x: point.x - drag.grab.x, y: point.y - drag.grab.y };
        const h = pose.height;
        pelvis.x = Math.max(board.left - 8, Math.min(board.right + 8, pelvis.x));
        pelvis.y = Math.max(board.bottom - 0.2 * h, Math.min(board.top + 0.2 * h, pelvis.y));
        const next = { ...stance, pelvis };
        setStance(next);
        setTargets((t) => regrab({ ...next, height: h, ape: pose.ape }, t));
      } else {
        setDrag({ ...drag, point });
      }
    },
    [drag, stance, pose.height, pose.ape, board, toBoard, regrab]
  );

  const handlePointerUp = useCallback(() => {
    if (drag?.kind === "limb") {
      const { id, point } = drag;
      const hold = nearestReachableHold(pose, id, point, holds);
      const target: LimbTargets[LimbId] = hold
        ? { kind: "hold", placementId: hold.placementId }
        : point.x >= board.left - 6 &&
            point.x <= board.right + 6 &&
            point.y >= board.bottom - 6 &&
            point.y <= board.top + 6
          ? { kind: "smear", x: point.x, y: point.y }
          : { kind: "free" };
      setTargets((t) => ({ ...t, [id]: target }));
    }
    setDrag(null);
  }, [drag, pose, holds, board]);

  const changeHeight = useCallback(
    (delta: number) => {
      if (!climber) return;
      const height = Math.max(HEIGHT_MIN, Math.min(HEIGHT_MAX, climber.height + delta));
      if (height === climber.height) return;
      updateTemplate(climber.id, { height });
      setTargets(autoAssign({ ...pose, height }, holds));
    },
    [climber, holds, pose, updateTemplate]
  );

  const changeApe = useCallback(
    (delta: number) => {
      if (!climber) return;
      const ape = Math.max(APE_MIN, Math.min(APE_MAX, climber.ape + delta));
      if (ape === climber.ape) return;
      updateTemplate(climber.id, { ape });
    },
    [climber, updateTemplate]
  );

  const reset = useCallback(() => {
    const next = initialStance(board, pose.height);
    setStance(next);
    setTargets(autoAssign({ ...next, height: pose.height, ape: pose.ape }, holds));
    setLoadedPoseId(null);
  }, [board, holds, pose.height, pose.ape]);

  const savePose = useCallback(async () => {
    if (!climber) return;
    const count = poses.filter((p) => p.templateId === climber.id).length;
    const snapshot: SavedPose = {
      id: generateUUID(),
      templateId: climber.id,
      name: `Pose ${count + 1}`,
      pelvis: { ...stance.pelvis },
      lean: stance.lean,
      targets: JSON.parse(JSON.stringify(targets)) as LimbTargets,
      createdAt: new Date().toISOString(),
    };
    const next = [...poses, snapshot];
    setPoses(next);
    setLoadedPoseId(snapshot.id);
    await persistPoses(climbUuid, next);
  }, [climber, poses, stance, targets, climbUuid]);

  const loadPose = useCallback((saved: SavedPose) => {
    setStance({ pelvis: { ...saved.pelvis }, lean: saved.lean });
    setTargets(JSON.parse(JSON.stringify(saved.targets)) as LimbTargets);
    setLoadedPoseId(saved.id);
    setConfirmPoseId(null);
  }, []);

  const deletePose = useCallback(
    async (id: string) => {
      const next = poses.filter((p) => p.id !== id);
      setPoses(next);
      if (loadedPoseId === id) setLoadedPoseId(null);
      setConfirmPoseId(null);
      await persistPoses(climbUuid, next);
    },
    [poses, loadedPoseId, climbUuid]
  );

  const scale = xSpacing;
  const limbWidth = (hand: boolean) => (hand ? 0.052 : 0.075) * pose.height * scale;
  const torsoWidth = 0.115 * pose.height * scale;
  const haloWidth = 0.022 * pose.height * scale;
  const headRadius = (0.095 * pose.height * scale) / 2;
  const fontSize = 3.1 * scale;
  const labelPad = 1.1 * scale;

  const pelvisSvg = toSvg(sk.pelvis);
  const shoulderSvg = toSvg(sk.shoulderCentre);
  const headSvg = toSvg(sk.headCentre);

  const previewTip = drag?.kind === "limb" ? drag.point : null;

  return (
    <>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${imgWidth} ${imgHeight}`}
        preserveAspectRatio="xMidYMid meet"
        className={`absolute inset-0 h-full w-full touch-none select-none ${className ?? ""}`}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        {/* Torso + head drag handle */}
        <g
          onPointerDown={(e) => handlePointerDown(e, null)}
          className="cursor-move"
          style={{ touchAction: "none" }}
        >
          <line
            x1={pelvisSvg.x}
            y1={pelvisSvg.y}
            x2={shoulderSvg.x}
            y2={shoulderSvg.y}
            stroke="transparent"
            strokeWidth={torsoWidth * 2.6}
            strokeLinecap="round"
          />
          <circle cx={headSvg.x} cy={headSvg.y} r={headRadius * 2} fill="transparent" />
        </g>

        {/* Body */}
        <g pointerEvents="none">
          <line
            x1={pelvisSvg.x}
            y1={pelvisSvg.y}
            x2={shoulderSvg.x}
            y2={shoulderSvg.y}
            stroke="rgba(0,0,0,0.55)"
            strokeWidth={torsoWidth + haloWidth * 2}
            strokeLinecap="round"
          />
          <line
            x1={pelvisSvg.x}
            y1={pelvisSvg.y}
            x2={shoulderSvg.x}
            y2={shoulderSvg.y}
            stroke="#e5e5e5"
            strokeWidth={torsoWidth}
            strokeLinecap="round"
          />
          <circle
            cx={headSvg.x}
            cy={headSvg.y}
            r={headRadius + haloWidth}
            fill="rgba(0,0,0,0.55)"
          />
          <circle cx={headSvg.x} cy={headSvg.y} r={headRadius} fill="#e5e5e5" />
          <line
            x1={pelvisSvg.x}
            y1={pelvisSvg.y}
            x2={shoulderSvg.x}
            y2={shoulderSvg.y}
            stroke="rgba(0,0,0,0.25)"
            strokeWidth={haloWidth * 0.6}
            strokeDasharray={`${scale} ${scale}`}
          />
        </g>

        {/* Limbs */}
        {resolved.limbs.map((limb) => {
          const anchor = toSvg(limb.anchor);
          const joint = limb.joint ? toSvg(limb.joint) : anchor;
          const tipAt =
            drag?.kind === "limb" && drag.id === limb.id && previewTip
              ? previewTip
              : limb.tip;
          const tip = toSvg(tipAt);
          const w = limbWidth(limb.hand);
          const color = limb.connected
            ? loadColor(limb.load)
            : limb.overstretched
              ? "#ef4444"
              : "#9ca3af";
          const dashed = !limb.connected;

          const mid = { x: (anchor.x + tip.x) / 2, y: (anchor.y + tip.y) / 2 };
          let lx = joint.x - mid.x;
          let ly = joint.y - mid.y;
          const len = Math.hypot(lx, ly) || 1;
          lx = joint.x + (lx / len) * fontSize * 1.5;
          ly = joint.y + (ly / len) * fontSize * 1.5;
          const labelText = limb.connected
            ? limb.kind === "smear"
              ? "smear"
              : `${Math.round(limb.load * 100)}%`
            : limb.overstretched
              ? "out of reach"
              : limb.kind === "free"
                ? "free"
                : "smear";
          const labelW = labelText.length * fontSize * 0.6 + labelPad * 2;

          return (
            <g key={limb.id}>
              <polyline
                points={`${anchor.x},${anchor.y} ${joint.x},${joint.y} ${tip.x},${tip.y}`}
                fill="none"
                stroke="rgba(0,0,0,0.55)"
                strokeWidth={w + haloWidth * 2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <polyline
                points={`${anchor.x},${anchor.y} ${joint.x},${joint.y} ${tip.x},${tip.y}`}
                fill="none"
                stroke={color}
                strokeWidth={w}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeOpacity={limb.connected ? 1 : 0.75}
                strokeDasharray={dashed ? `${w * 1.4} ${w * 1.1}` : undefined}
              />
              {/* grab target ring — dashed for smears, since there is no hold there */}
              {limb.target && (
                <circle
                  cx={toSvg(limb.target).x}
                  cy={toSvg(limb.target).y}
                  r={w * 0.75}
                  fill="none"
                  stroke={color}
                  strokeWidth={haloWidth}
                  strokeOpacity={limb.connected ? 0.95 : 0.5}
                  strokeDasharray={
                    limb.connected && limb.kind === "hold"
                      ? undefined
                      : `${haloWidth * 2} ${haloWidth * 2}`
                  }
                />
              )}

              <circle
                cx={tip.x}
                cy={tip.y}
                r={w * 1.6}
                fill="transparent"
                className="cursor-grab"
                style={{ touchAction: "none" }}
                onPointerDown={(e) => handlePointerDown(e, limb.id)}
              />
              <circle cx={tip.x} cy={tip.y} r={w * 0.72} fill={color} pointerEvents="none" />

              {labelText && (
                <g pointerEvents="none">
                  <rect
                    x={lx - labelW / 2}
                    y={ly - fontSize * 0.75}
                    width={labelW}
                    height={fontSize * 1.5}
                    rx={fontSize * 0.75}
                    fill="rgba(10,10,10,0.82)"
                  />
                  <text
                    x={lx}
                    y={ly}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={fontSize}
                    fontFamily="system-ui, sans-serif"
                    fontWeight={600}
                    fill={limb.connected ? color : "#f87171"}
                  >
                    {labelText}
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </svg>

      {/* Top controls */}
      <div className="absolute inset-x-2 top-1 z-20 space-y-1.5">
        {templates.length > 1 && (
          <div className="flex gap-1.5 overflow-x-auto pb-0.5">
            {templates.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  setActiveClimber(t.id);
                  setLoadedPoseId(null);
                  setConfirmPoseId(null);
                }}
                className={`shrink-0 rounded-full border px-3 py-1 text-[11px] font-semibold backdrop-blur ${
                  t.id === climber?.id
                    ? "border-amber-400/60 bg-amber-400/15 text-amber-200"
                    : "border-neutral-700 bg-neutral-900/85 text-neutral-400"
                }`}
              >
                {t.name}
                <span className="ml-1 font-normal tabular-nums opacity-70">
                  {formatHeight(t.height)}
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center gap-1.5 rounded-xl border border-neutral-700 bg-neutral-900/92 px-2 py-1.5 backdrop-blur">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className="shrink-0 text-neutral-300">
            <path d="M12 2c.83 0 1.5.67 1.5 1.5S12.83 5 12 5s-1.5-.67-1.5-1.5S11.17 2 12 2zm-3.2 4.2c.3-.9 1.1-1.2 1.9-1.2h2.6c.8 0 1.6.3 1.9 1.2l1.3 3.9c.2.6-.1 1.3-.7 1.5-.6.2-1.3-.1-1.5-.7l-.6-1.8v3.2l1.6 6.4c.2.6-.3 1.2-.9 1.2-.5 0-.9-.3-1-.8L12 14.8l-1.3 4.3c-.1.5-.5.8-1 .8-.6 0-1.1-.6-.9-1.2l1.6-6.4V9.1l-.6 1.8c-.2.6-.9.9-1.5.7-.6-.2-.9-.9-.7-1.5l1.3-3.9z" />
          </svg>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-[11px] font-semibold text-neutral-200">
              Hands {Math.round(resolved.handLoad * 100)}%
              <span className="text-neutral-500"> · </span>
              Feet {Math.round(resolved.footLoad * 100)}%
            </p>
            <p className="truncate text-[10px] text-neutral-400">{statusText(resolved)}</p>
          </div>
          <button
            onClick={() => setShowSize((v) => !v)}
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
              showSize ? "bg-neutral-700 text-white" : "text-neutral-400 active:bg-neutral-800"
            }`}
            aria-label="Climber size"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M5 8h14M5 16h14" />
              <circle cx="9" cy="8" r="1.9" fill="currentColor" stroke="none" />
              <circle cx="15" cy="16" r="1.9" fill="currentColor" stroke="none" />
            </svg>
          </button>
          <button
            onClick={savePose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-neutral-300 active:bg-neutral-800"
            aria-label="Save pose"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 3h12a1 1 0 0 1 1 1v16l-7-4-7 4V4a1 1 0 0 1 1-1Z" />
            </svg>
          </button>
          <button
            onClick={reset}
            className="flex h-8 shrink-0 items-center justify-center rounded-lg px-2 text-[11px] font-semibold text-neutral-300 active:bg-neutral-800"
          >
            Reset
          </button>
          <button
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-neutral-400 active:bg-neutral-800"
            aria-label="Close body overlay"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {showSize && climber && (
          <div className="space-y-1.5 rounded-xl border border-neutral-700 bg-neutral-900/92 px-2.5 py-2 backdrop-blur">
            <Stepper
              label="Height"
              value={formatHeight(climber.height)}
              onMinus={() => changeHeight(-1)}
              onPlus={() => changeHeight(1)}
              minusDisabled={climber.height <= HEIGHT_MIN}
              plusDisabled={climber.height >= HEIGHT_MAX}
            />
            <Stepper
              label="Ape"
              value={`${climber.ape > 0 ? "+" : ""}${climber.ape}"`}
              onMinus={() => changeApe(-1)}
              onPlus={() => changeApe(1)}
              minusDisabled={climber.ape <= APE_MIN}
              plusDisabled={climber.ape >= APE_MAX}
            />
            <p className="text-[10px] leading-tight tabular-nums text-neutral-400">
              {formatHeight(climber.height)} · {Math.round(resolved.metrics.armReach)}&quot; arm reach
              · {Math.round(resolved.metrics.legReach)}&quot; leg reach
            </p>
            <p className="text-[10px] leading-tight text-neutral-500">
              Saved to {climber.name} — edit climbers in Settings. Drag the torso to move, drag a
              hand or foot to a hold or onto bare wall to smear.
            </p>
          </div>
        )}
      </div>

      {/* Saved poses for this climber */}
      {climbPoses.length > 0 && (
        <div className="absolute inset-x-2 bottom-1 z-20">
          <div className="flex gap-1.5 overflow-x-auto rounded-xl border border-neutral-700 bg-neutral-900/92 p-1.5 backdrop-blur">
            {climbPoses.map((p) => {
              const armed = confirmPoseId === p.id;
              return (
                <div
                  key={p.id}
                  className={`flex shrink-0 items-center overflow-hidden rounded-lg border ${
                    p.id === loadedPoseId
                      ? "border-amber-400/60 bg-amber-400/15"
                      : "border-neutral-700 bg-neutral-800/80"
                  }`}
                >
                  <button
                    onClick={() => loadPose(p)}
                    className={`px-2.5 py-1 text-[11px] font-semibold ${
                      p.id === loadedPoseId ? "text-amber-200" : "text-neutral-300"
                    }`}
                  >
                    {p.name}
                  </button>
                  <button
                    onClick={() => {
                      if (armed) void deletePose(p.id);
                      else setConfirmPoseId(p.id);
                    }}
                    aria-label={armed ? `Confirm delete ${p.name}` : `Delete ${p.name}`}
                    className={`flex h-full items-center px-1.5 py-1 text-[11px] font-bold ${
                      armed ? "bg-red-600/40 text-red-100" : "text-neutral-500"
                    }`}
                  >
                    {armed ? "del?" : "×"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

function statusText(resolved: ReturnType<typeof resolveBody>): string {
  const over = resolved.limbs.filter((l) => l.overstretched);
  if (over.length > 0) {
    return `${over.map((l) => limbLabel(l.id)).join(", ")} can't reach — move closer or let go`;
  }
  if (resolved.contactCount === 0) {
    return `Floating — nothing within ${Math.round(resolved.metrics.armReach)}" of reach`;
  }
  if (resolved.hanging) {
    return "Hanging — all weight on the hands";
  }
  const worst = resolved.limbs
    .filter((l) => l.connected)
    .sort((a, b) => b.extension - a.extension)[0];
  if (worst && worst.extension > 0.92) {
    return `${limbLabel(worst.id)} at ${Math.round(worst.extension * 100)}% extension`;
  }
  return `${resolved.contactCount} points of contact · max ${Math.round(resolved.maxExtension * 100)}% extension`;
}

function Stepper({
  label,
  value,
  onMinus,
  onPlus,
  minusDisabled,
  plusDisabled,
}: {
  label: string;
  value: string;
  onMinus: () => void;
  onPlus: () => void;
  minusDisabled?: boolean;
  plusDisabled?: boolean;
}) {
  const btn =
    "flex h-8 w-9 items-center justify-center rounded-lg bg-neutral-800 text-lg font-bold leading-none text-neutral-200 active:bg-neutral-700 disabled:text-neutral-600";
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 text-[11px] font-medium text-neutral-400">{label}</span>
      <button onClick={onMinus} disabled={minusDisabled} className={btn} aria-label={`Decrease ${label}`}>
        −
      </button>
      <span className="min-w-[3rem] flex-1 text-center text-[13px] font-semibold tabular-nums text-white">
        {value}
      </span>
      <button onClick={onPlus} disabled={plusDisabled} className={btn} aria-label={`Increase ${label}`}>
        +
      </button>
    </div>
  );
}

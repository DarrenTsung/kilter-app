/**
 * A simple 2D body model used by the climb editor's "body" overlay.
 *
 * A climber is drawn flat against the wall (the usual beta-diagram view), so we
 * only need x/y in the plane of the board. All lengths are in INCHES in board
 * coordinates: x grows to the right from the board's left edge, y grows UP from
 * the board's bottom edge (matching `holes.x` / `holes.y`).
 *
 * Proportions are standard anthropometric fractions of stature, chosen so the
 * ends agree with well known landmarks:
 *
 *   arm span                     = height                  (1.00 H)
 *   shoulder joint height        = 0.818 H
 *   hip joint height             = 0.530 H
 *   centre of mass               = 0.550 H
 *
 * The model is deliberately torso-rigid: the spine is one segment that can be
 * tilted, and each limb is a two-bone chain solved with inverse kinematics.
 */

export interface BodyPose {
  /** Hip joint centre, in board inches. */
  pelvis: Point;
  /** Torso tilt in radians. 0 = shoulders directly above the hips, + = lean right. */
  lean: number;
  /** Stature in inches. */
  height: number;
  /** Ape index in inches: added to each arm's reach (can be negative). */
  ape: number;
  /** 0 = stiff .. 3 = very flexible. Drives joint range of motion. */
  flex: number;
}

export interface Point {
  x: number;
  y: number;
}

export type LimbId = "lh" | "rh" | "lf" | "rf";

export const LIMB_IDS: LimbId[] = ["lh", "rh", "lf", "rf"];

export function isHand(limb: LimbId): boolean {
  return limb === "lh" || limb === "rh";
}

/** board inches -> screen-ish label */
export function limbLabel(limb: LimbId): string {
  const side = limb[0] === "l" ? "Left" : "Right";
  return `${side} ${isHand(limb) ? "hand" : "foot"}`;
}

/** Fractions of stature. */
export const BODY = {
  shoulderHeight: 0.818,
  hipHeight: 0.53,
  shoulderWidth: 0.245,
  hipWidth: 0.191,
  upperArm: 0.186,
  forearm: 0.146,
  /** wrist to the middle of the grip — you hold a hold with your hand, not your fingertip */
  handLength: 0.046,
  thigh: 0.245,
  shin: 0.246,
  ankle: 0.039,
  headHeight: 0.133,
  headWidth: 0.085,
  neck: 0.052,
  comHeight: 0.55,
  /** torso thickness used for drawing */
  torsoDepth: 0.11,
  /** how far the hip joints sit off the midline */
  hipHalfWidth: 0.0955,
} as const;

/** Reaches and segment lengths for a pose, in inches. */
export interface BodyMetrics {
  torso: number;
  armBones: [number, number];
  legBones: [number, number];
  /** shoulder joint to grip centre */
  armReach: number;
  /** hip joint to ankle */
  legReach: number;
  shoulderWidth: number;
  headHeight: number;
  headWidth: number;
}

export function metrics(pose: BodyPose): BodyMetrics {
  const h = pose.height;
  const armReach = (BODY.upperArm + BODY.forearm + BODY.handLength) * h + pose.ape;
  const upperArm = BODY.upperArm * h + pose.ape * 0.5;
  const forearm = BODY.forearm * h + pose.ape * 0.5;
  const thigh = BODY.thigh * h;
  const shin = BODY.shin * h;
  return {
    torso: (BODY.shoulderHeight - BODY.hipHeight) * h,
    armBones: [upperArm, forearm + BODY.handLength * h],
    legBones: [thigh, shin + BODY.ankle * h],
    armReach,
    legReach: thigh + shin,
    shoulderWidth: BODY.shoulderWidth * h,
    headHeight: BODY.headHeight * h,
    headWidth: BODY.headWidth * h,
  };
}

/** A hold the climber could grab, in board inches. */
export interface BodyHold {
  placementId: number;
  x: number;
  y: number;
  /** role the climb assigns it, used to bias hand vs foot assignment */
  category: "hand" | "foot" | "start" | "finish" | null;
}

export type LimbTarget =
  | { kind: "hold"; placementId: number }
  | { kind: "smear"; x: number; y: number }
  | { kind: "free" };

export type LimbTargets = Record<LimbId, LimbTarget>;

export const FREE_TARGETS: LimbTargets = {
  lh: { kind: "free" },
  rh: { kind: "free" },
  lf: { kind: "free" },
  rf: { kind: "free" },
};

export interface Skeleton {
  pelvis: Point;
  shoulderCentre: Point;
  headCentre: Point;
  com: Point;
  /** axis from pelvis to shoulder centre */
  torsoAxis: Point;
  anchors: Record<LimbId, Point>;
}

export function skeleton(pose: BodyPose): Skeleton {
  const m = metrics(pose);
  const sin = Math.sin(pose.lean);
  const cos = Math.cos(pose.lean);
  const shoulderCentre = {
    x: pose.pelvis.x + m.torso * sin,
    y: pose.pelvis.y + m.torso * cos,
  };
  // perpendicular to the torso axis, pointing to the climber's right
  // (we look at their back, so their right hand is on the right of the screen)
  const perp = { x: cos, y: -sin };
  const halfShoulder = m.shoulderWidth / 2;
  const halfHip = BODY.hipHalfWidth * pose.height;

  // Shoulder joint -> centre of the head is the neck plus half the head. This
  // is deliberately NOT offset by the torso length: shoulderCentre is already
  // the top of the torso, so adding m.torso here doubled the spine and left the
  // head floating a whole torso above the shoulders. The half-head is taken
  // from headWidth because that is the circle we actually draw.
  const neckRise = BODY.neck * pose.height + m.headWidth / 2;
  const headCentre = {
    x: shoulderCentre.x + neckRise * sin,
    y: shoulderCentre.y + neckRise * cos,
  };

  // centre of mass sits a little above the hip joints, along the spine
  const comRise = (BODY.comHeight - BODY.hipHeight) * pose.height;
  const com = {
    x: pose.pelvis.x + comRise * sin,
    y: pose.pelvis.y + comRise * cos,
  };

  return {
    pelvis: pose.pelvis,
    shoulderCentre,
    headCentre,
    com,
    torsoAxis: { x: sin, y: cos },
    anchors: {
      // lh/lf sit on -x, rh/rf on +x: we view the climber from behind
      lh: {
        x: shoulderCentre.x - halfShoulder * perp.x,
        y: shoulderCentre.y - halfShoulder * perp.y,
      },
      rh: {
        x: shoulderCentre.x + halfShoulder * perp.x,
        y: shoulderCentre.y + halfShoulder * perp.y,
      },
      lf: { x: pose.pelvis.x - halfHip * perp.x, y: pose.pelvis.y - halfHip * perp.y },
      rf: { x: pose.pelvis.x + halfHip * perp.x, y: pose.pelvis.y + halfHip * perp.y },
    },
  };
}

/**
 * Two-bone IK. Returns the middle joint position, and whether the target was
 * out of range (in which case the joint sits on the fully extended chain).
 */
function solveJoint(
  anchor: Point,
  target: Point,
  l1: number,
  l2: number,
  pole: Point
): { joint: Point; reached: boolean } {
  const dx = target.x - anchor.x;
  const dy = target.y - anchor.y;
  const raw = Math.hypot(dx, dy);
  const reach = l1 + l2;
  const reached = raw <= reach;
  const d = Math.max(1e-6, Math.min(raw, reach));

  const ux = dx / (raw || 1);
  const uy = dy / (raw || 1);
  const along = (d * d + l1 * l1 - l2 * l2) / (2 * d);
  const height = Math.sqrt(Math.max(0, l1 * l1 - along * along));

  let px = -uy;
  let py = ux;
  if (px * pole.x + py * pole.y < 0) {
    px = -px;
    py = -py;
  }

  return {
    joint: {
      x: anchor.x + ux * along + px * height,
      y: anchor.y + uy * along + py * height,
    },
    reached,
  };
}

const DEG = Math.PI / 180;

/**
 * Joint range of motion, in the board plane.
 *
 * A climber facing the wall shows us their *frontal* plane, so the only motion
 * we can actually see is abduction — a thigh swinging out to the side. That
 * distinction matters: a real high step drives the knee toward the wall and
 * barely moves in this view at all, so drawing one as a thigh swung 90° out to
 * the side is simply wrong. Capping the angle and refusing the contact is the
 * honest answer, and it is what stops the model folding people into shapes no
 * one can actually make.
 *
 * `0` is straight down the spine, `+` swings out to that limb's own side up to
 * `180` (straight overhead), and `-` crosses the midline.
 */
export interface RomLimits {
  hipOut: number;
  hipIn: number;
  shoulderOut: number;
  shoulderIn: number;
  /** smallest interior angle the knee can fold to */
  kneeMin: number;
  elbowMin: number;
}

/** Indexed by `flex`: stiff (0) through very flexible (3).
 *
 * The hip is where the real constraint lives. Shoulders are mobile enough that
 * `shoulderOut` is effectively "overhead is fine" for everyone, and
 * `shoulderIn` has to be generous because a hand crossing the midline is an
 * ordinary move, not a contortion. The hips, though, are what stop the model
 * drawing a "high step" as a thigh stuck out sideways.
 */
const ROM_TABLE: RomLimits[] = [
  { hipOut: 46, hipIn: 24, shoulderOut: 172, shoulderIn: 55, kneeMin: 52, elbowMin: 42 },
  { hipOut: 60, hipIn: 32, shoulderOut: 178, shoulderIn: 70, kneeMin: 40, elbowMin: 32 },
  { hipOut: 75, hipIn: 42, shoulderOut: 180, shoulderIn: 85, kneeMin: 30, elbowMin: 25 },
  { hipOut: 92, hipIn: 52, shoulderOut: 180, shoulderIn: 100, kneeMin: 20, elbowMin: 18 },
];

export function romLimits(flex: number): RomLimits {
  const i = Math.max(0, Math.min(ROM_TABLE.length - 1, Math.round(flex)));
  return ROM_TABLE[i];
}

/**
 * Signed angle of a limb's root segment, in degrees. Measured against the spine
 * rather than the world, so it follows the torso as it leans.
 */
export function rootAngle(
  limb: LimbId,
  anchor: Point,
  point: Point,
  torsoAxis: Point
): number {
  const dx = point.x - anchor.x;
  const dy = point.y - anchor.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  // Same `perp` skeleton() uses; "outward" is mirrored for the left limbs.
  const up = ux * torsoAxis.x + uy * torsoAxis.y;
  const out =
    (ux * torsoAxis.y + uy * -torsoAxis.x) *
    (limb === "lh" || limb === "lf" ? -1 : 1);
  return Math.atan2(out, -up) / DEG;
}

/** Unit vector at `angle` degrees from straight down the spine. Inverse of
 *  `rootAngle`, so `directionAt(rootAngle(...))` round-trips exactly. */
function directionAt(angle: number, limb: LimbId, torsoAxis: Point): Point {
  const a = angle * DEG;
  const side = limb === "lh" || limb === "lf" ? -1 : 1;
  const dx = -torsoAxis.x;
  const dy = -torsoAxis.y;
  const ox = torsoAxis.y * side;
  const oy = -torsoAxis.x * side;
  return {
    x: Math.cos(a) * dx + Math.sin(a) * ox,
    y: Math.cos(a) * dy + Math.sin(a) * oy,
  };
}

/** Is this limb angle inside the joint's range? */
export function angleInRom(limb: LimbId, angle: number, rom: RomLimits): boolean {
  const hand = isHand(limb);
  const out = hand ? rom.shoulderOut : rom.hipOut;
  const inn = hand ? rom.shoulderIn : rom.hipIn;
  // Reaching overhead is fine whichever way the limb is tipped, and the signed
  // angle is degenerate up there: "up and a little inward" reads as -170 while
  // "up and a little outward" reads as +170. Two degrees apart in reality, 340
  // apart here. So the side limits only apply away from the top.
  if (hand && Math.abs(angle) >= 145) return true;
  return Math.abs(angle) <= out && angle >= -inn;
}

/** The closest angle to `angle` this joint can actually make. */
function fitAngle(limb: LimbId, angle: number, rom: RomLimits): number {
  if (angleInRom(limb, angle, rom)) return angle;
  const out = isHand(limb) ? rom.shoulderOut : rom.hipOut;
  const inn = isHand(limb) ? rom.shoulderIn : rom.hipIn;
  return Math.max(-inn, Math.min(out, angle));
}

/** Shortest hip-to-ankle (shoulder-to-grip) distance that folds no tighter
 *  than `minAngle`, from the law of cosines. */
function minDistanceForFold(l1: number, l2: number, minAngle: number): number {
  const c = Math.cos(minAngle * DEG);
  return Math.sqrt(Math.max(1e-6, l1 * l1 + l2 * l2 - 2 * l1 * l2 * c));
}

/**
 * Can this limb work this point at all — reach *and* joint range?
 *
 * The IK can bend a knee or elbow, but it can never swing the root segment
 * further than the joint allows, so testing the anchor-to-point direction is
 * both necessary and cheap.
 */
function canReachWith(
  limb: LimbId,
  anchor: Point,
  point: Point,
  m: BodyMetrics,
  torsoAxis: Point,
  rom: RomLimits
): boolean {
  const hand = isHand(limb);
  const reach = hand ? m.armReach : m.legReach;
  const [l1, l2] = hand ? m.armBones : m.legBones;
  const d = Math.hypot(point.x - anchor.x, point.y - anchor.y);
  if (d > reach * 0.985) return false;
  if (d < minDistanceForFold(l1, l2, hand ? rom.elbowMin : rom.kneeMin)) return false;
  return angleInRom(limb, rootAngle(limb, anchor, point, torsoAxis), rom);
}

export interface ResolvedLimb {
  id: LimbId;
  hand: boolean;
  anchor: Point;
  /** where the limb is pointing (the hold, the smear, or where it hangs) */
  target: Point | null;
  kind: LimbTarget["kind"];
  placementId: number | null;
  /** target within reach */
  connected: boolean;
  /** true when the limb is stretching toward something it cannot reach */
  overstretched: boolean;
  /** true when the limb is close enough but the joint cannot get there */
  romLimited: boolean;
  /** signed angle of the root segment from straight-down the spine, degrees */
  angle: number;
  distance: number;
  reach: number;
  /** distance / reach, 0..1+ */
  extension: number;
  joint: Point | null;
  /** where the hand/foot is drawn */
  tip: Point;
  /** share of body weight, 0..1 */
  load: number;
  /** hands only: true when the hold is above the shoulder (pull) */
  pulling: boolean | null;
}

export interface ResolvedBody {
  pose: BodyPose;
  metrics: BodyMetrics;
  skeleton: Skeleton;
  limbs: ResolvedLimb[];
  handLoad: number;
  footLoad: number;
  /** most extended connected limb */
  maxExtension: number;
  /** true when nothing is below the centre of mass, i.e. hanging off the arms */
  hanging: boolean;
  contactCount: number;
}

function targetPoint(
  target: LimbTarget,
  holdById: Map<number, BodyHold>
): { point: Point | null; placementId: number | null } {
  if (target.kind === "hold") {
    const hold = holdById.get(target.placementId);
    if (!hold) return { point: null, placementId: null };
    return { point: { x: hold.x, y: hold.y }, placementId: hold.placementId };
  }
  if (target.kind === "smear") {
    return { point: { x: target.x, y: target.y }, placementId: null };
  }
  return { point: null, placementId: null };
}

/**
 * Weight distribution.
 *
 * This is a heuristic, not a rigid-body solve. Each contact gets a share
 * based on two things:
 *
 *   1. how close it is to the centre of mass horizontally — that is the lever
 *      arm its force has to work against; and
 *   2. how stacked it is relative to its own joint — an arm straight overhead
 *      can hang off the hold, an arm stretched out sideways cannot.
 *
 * Contacts *above* the centre of mass are damped, since those only contribute
 * through tension.
 *
 * It behaves the way you would expect at the extremes: standing over two
 * footholds puts nearly everything on the feet, and hanging off two handholds
 * with nothing underneath puts everything on the hands.
 */
function distributeLoad(
  limbs: ResolvedLimb[],
  com: Point,
  height: number
): void {
  const contacts = limbs.filter((l) => l.connected && l.target);
  for (const l of limbs) l.load = 0;
  if (contacts.length === 0) return;

  const slack = 0.15 * height;
  const weights = contacts.map((l) => {
    const dx = Math.abs(l.target!.x - com.x);
    const above = l.target!.y > com.y;
    // how vertical the limb is: 1 = stacked over the joint, 0 = straight out
    const span = l.distance || 1;
    const verticality = Math.abs(l.target!.y - l.anchor.y) / span;
    return (
      (1 / (dx + slack)) *
      (above ? 0.5 : 1) *
      (0.4 + 0.6 * verticality)
    );
  });
  const total = weights.reduce((a, b) => a + b, 0);
  contacts.forEach((l, i) => {
    l.load = weights[i] / total;
  });
}

export function resolveBody(
  pose: BodyPose,
  targets: LimbTargets,
  holds: BodyHold[]
): ResolvedBody {
  const m = metrics(pose);
  const sk = skeleton(pose);
  const rom = romLimits(pose.flex);
  const holdById = new Map(holds.map((h) => [h.placementId, h]));

  const limbs: ResolvedLimb[] = LIMB_IDS.map((id) => {
    const hand = isHand(id);
    const anchor = sk.anchors[id];
    const reach = hand ? m.armReach : m.legReach;
    const [l1, l2] = hand ? m.armBones : m.legBones;
    const dMin = minDistanceForFold(l1, l2, hand ? rom.elbowMin : rom.kneeMin);

    const { point, placementId } = targetPoint(targets[id], holdById);
    const distance = point ? Math.hypot(point.x - anchor.x, point.y - anchor.y) : 0;
    const angle = point ? rootAngle(id, anchor, point, sk.torsoAxis) : 0;
    // Too close is as impossible as too far: the knee or elbow cannot fold past
    // its own limit, and that is most of what made the old poses look wrong.
    const inRange = !!point && distance <= reach && distance >= dMin;
    const inRom = !!point && angleInRom(id, angle, rom);
    const connected = inRange && inRom;
    const romLimited = !!point && inRange && !inRom;
    const overstretched = !!point && !inRange;
    const extension = point && reach > 0 ? distance / reach : 0;

    // Outward-and-down for elbows, outward for knees, so the joint bows away
    // from the body the way a real limb does. lh/lf are on the -x side.
    const outward = id === "lh" || id === "lf" ? -1 : 1;
    const pole = hand
      ? { x: outward * 0.35, y: -1 }
      : { x: outward * 1, y: 0.25 };

    let joint: Point | null = null;
    let tip: Point;
    if (point) {
      // Draw the limb where the body can actually put it: swing it back to the
      // joint limit and shorten it to the fold limit, so a rejected target
      // reads as "I can only get this far" instead of a pretzel.
      const dir = directionAt(
        connected ? angle : fitAngle(id, angle, rom),
        id,
        sk.torsoAxis
      );
      const len = Math.max(dMin, Math.min(distance, reach));
      tip = { x: anchor.x + dir.x * len, y: anchor.y + dir.y * len };
      joint = solveJoint(anchor, tip, l1, l2, pole).joint;
    } else {
      // No target: let the limb hang straight down, slightly bent.
      const hang = { x: anchor.x, y: anchor.y - reach * 0.92 };
      joint = solveJoint(anchor, hang, l1, l2, pole).joint;
      tip = hang;
    }

    return {
      id,
      hand,
      anchor,
      target: point,
      kind: point ? targets[id].kind : "free",
      placementId,
      connected,
      overstretched,
      romLimited,
      angle,
      distance,
      reach,
      extension,
      joint,
      tip,
      load: 0,
      pulling: hand && point ? point.y > anchor.y : null,
    };
  });

  distributeLoad(limbs, sk.com, pose.height);

  const handLoad = limbs.filter((l) => l.hand).reduce((s, l) => s + l.load, 0);
  const connectedLimbs = limbs.filter((l) => l.connected);

  return {
    pose,
    metrics: m,
    skeleton: sk,
    limbs,
    handLoad,
    footLoad: 1 - handLoad,
    maxExtension: connectedLimbs.reduce((s, l) => Math.max(s, l.extension), 0),
    hanging: connectedLimbs.length > 0 && !connectedLimbs.some((l) => l.target!.y < sk.com.y),
    contactCount: connectedLimbs.length,
  };
}

/**
 * Pick a hold for every limb.
 *
 * Candidates are scored on distance, nudged so that hands prefer holds the
 * climb tagged as hand/start/finish and feet prefer the ones it tagged as foot.
 * Limbs also prefer to keep to their own side of the pelvis: a foot or hand
 * that has to cross the midline to reach the nearest hold reads as a mistake
 * even when it is geometrically the closest option. Assignment is greedy over
 * the globally closest pairs so two limbs never share a hold.
 */
export function autoAssign(
  pose: BodyPose,
  holds: BodyHold[],
  preferredRole: "any" | "climb" = "climb"
): LimbTargets {
  const m = metrics(pose);
  const sk = skeleton(pose);
  const rom = romLimits(pose.flex);

  type Candidate = { limb: LimbId; hold: BodyHold; score: number };
  const candidates: Candidate[] = [];

  for (const id of LIMB_IDS) {
    const hand = isHand(id);
    const anchor = sk.anchors[id];

    for (const hold of holds) {
      // Reach, fold and joint range all in one test, so every automatically
      // assigned pose is one a real person could hold.
      if (!canReachWith(id, anchor, hold, m, sk.torsoAxis, rom)) continue;
      const d = Math.hypot(hold.x - anchor.x, hold.y - anchor.y);

      let penalty = 1;
      if (preferredRole === "climb" && hold.category) {
        const matches = hand
          ? hold.category !== "foot"
          : hold.category === "foot";
        penalty = matches ? 1 : 1.45;
      }
      // Keep the limb on its own side of the body (lh/lf are on -x).
      if ((hold.x - sk.pelvis.x) * (id === "lh" || id === "lf" ? -1 : 1) < 0) {
        penalty *= 1.45;
      }
      candidates.push({ limb: id, hold, score: d * penalty });
    }
  }

  candidates.sort((a, b) => a.score - b.score);

  const out: LimbTargets = { ...FREE_TARGETS };
  const usedLimbs = new Set<LimbId>();
  const usedHolds = new Set<number>();
  for (const c of candidates) {
    if (usedLimbs.has(c.limb) || usedHolds.has(c.hold.placementId)) continue;
    usedLimbs.add(c.limb);
    usedHolds.add(c.hold.placementId);
    out[c.limb] = { kind: "hold", placementId: c.hold.placementId };
  }
  return out;
}

/**
 * Nearest hold to a point that the given limb can still reach.
 *
 * `maxDistance` is how far from the drop point we are willing to snap. Hands
 * pass Infinity: a hand is either gripping a hold or it is doing nothing, and
 * "pressing the wall" is not a thing a hand can do in a beta diagram, so any
 * drop on the board grabs the closest hold within reach. Feet pass a small
 * radius so that dropping a foot on blank wall stays a smear.
 */
export function nearestReachableHold(
  pose: BodyPose,
  limb: LimbId,
  point: Point,
  holds: BodyHold[],
  maxDistance = Infinity
): BodyHold | null {
  const m = metrics(pose);
  const sk = skeleton(pose);
  const rom = romLimits(pose.flex);
  const anchor = sk.anchors[limb];

  let best: BodyHold | null = null;
  let bestDist = Infinity;
  for (const hold of holds) {
    if (!canReachWith(limb, anchor, hold, m, sk.torsoAxis, rom)) continue;
    const grabDist = Math.hypot(hold.x - point.x, hold.y - point.y);
    if (grabDist < bestDist) {
      bestDist = grabDist;
      best = hold;
    }
  }
  // only snap when the finger actually landed near a hold
  return best && bestDist <= maxDistance ? best : null;
}

/** Is this spot on the board (rather than off the side or above the top)? */
export function isOnBoard(point: Point, board: BoardBounds): boolean {
  return (
    point.x >= board.left - 6 &&
    point.x <= board.right + 6 &&
    point.y >= board.bottom - 6 &&
    point.y <= board.top + 6
  );
}

export interface BoardBounds {
  left: number;
  right: number;
  bottom: number;
  top: number;
}

/** The neutral stance: centred horizontally, a bit below the middle. */
export function initialStance(board: BoardBounds, height: number): Point {
  return {
    x: (board.left + board.right) / 2,
    y: (board.bottom + board.top) / 2 - height * 0.18,
  };
}

/**
 * Find a place to stand where the limbs can actually reach the climb.
 *
 * A climb's holds are not spread evenly — a hard problem may put everything in
 * one corner — so dropping the body at the centre of the board often opens the
 * overlay on a figure holding nothing. This walks a coarse grid of stances,
 * scores each by how many limbs got a hold and how relaxed they are, and keeps
 * the best. Falling back to the neutral stance when nothing reaches keeps the
 * behaviour unchanged for the easy climbs where it already worked.
 */
export function fitStance(
  board: BoardBounds,
  holds: BodyHold[],
  height: number,
  ape: number,
  flex: number
): { stance: { pelvis: Point; lean: number }; targets: LimbTargets } {
  const centre = initialStance(board, height);
  const width = board.right - board.left;

  const xs = [0, -0.1, 0.1, -0.2, 0.2].map((f) => centre.x + f * width);
  const ys = [0, -0.12, 0.12, -0.24, 0.24, -0.36, 0.36].map(
    (f) => centre.y + f * height
  );

  let best: { pelvis: Point; targets: LimbTargets; score: number } | null = null;

  for (const y of ys) {
    for (const x of xs) {
      const pelvis = { x, y };
      const pose: BodyPose = { pelvis, lean: 0, height, ape, flex };
      const targets = autoAssign(pose, holds);
      const resolved = resolveBody(pose, targets, holds);

      const hands = resolved.limbs.filter((l) => l.hand && l.connected).length;
      const feet = resolved.limbs.filter((l) => !l.hand && l.connected).length;
      const stretch = resolved.limbs
        .filter((l) => l.connected)
        .reduce((s, l) => s + l.extension, 0);

      // Contact is what matters; prefer a relaxed pose and a central position
      // only to break ties between equally good fits.
      const score =
        hands * 10 +
        feet * 6 -
        stretch * 1.5 -
        (Math.abs(x - centre.x) / width) * 2 -
        (Math.abs(y - centre.y) / height) * 2;

      if (!best || score > best.score) best = { pelvis, targets, score };
    }
  }

  const chosen = best ?? {
    pelvis: centre,
    targets: autoAssign({ pelvis: centre, lean: 0, height, ape, flex }, holds),
    score: 0,
  };
  return { stance: { pelvis: chosen.pelvis, lean: 0 }, targets: chosen.targets };
}

export function formatHeight(inches: number): string {
  const total = Math.round(inches);
  const ft = Math.floor(total / 12);
  const inPart = total - ft * 12;
  return `${ft}'${inPart}"`;
}

export const HEIGHT_MIN = 56;
export const HEIGHT_MAX = 80;
export const DEFAULT_HEIGHT = 67; // 5'7"
export const APE_MIN = -4;
export const APE_MAX = 6;
export const FLEX_MIN = 0;
export const FLEX_MAX = 3;
export const DEFAULT_FLEX = 1;
export const FLEX_LABELS = ["Stiff", "Average", "Flexible", "Very flexible"];

/**
 * How far a dropped limb will snap to a hold, in board inches. A hand snaps
 * from anywhere (it can only ever hold), a foot only from close by so that
 * dropping it on blank wall stays a smear.
 */
export const HAND_SNAP_INCHES = Infinity;
export const FOOT_SNAP_INCHES = 3.5;

/** A named climber whose proportions you can switch between. */
export interface ClimberTemplate {
  id: string;
  name: string;
  height: number;
  ape: number;
  /** 0 = stiff .. 3 = very flexible */
  flex: number;
}

/**
 * A pose snapshotted by the user so they can come back to it. Positions are
 * absolute board inches, so a saved pose still makes sense after the climber's
 * height or ape index is corrected.
 */
export interface SavedPose {
  id: string;
  /** which climber this pose belongs to — poses are listed per person */
  templateId: string;
  name: string;
  pelvis: Point;
  lean: number;
  targets: LimbTargets;
  createdAt: string;
}

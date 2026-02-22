import { getDB } from "./index";
import type { FilterState } from "@/store/filterStore";

export interface ClimbResult {
  uuid: string;
  name: string;
  setter_username: string;
  frames: string;
  layout_id: number;
  edge_left: number;
  edge_right: number;
  edge_bottom: number;
  edge_top: number;
  // From climb_stats
  angle: number;
  display_difficulty: number;
  benchmark_difficulty: number | null;
  difficulty_average: number;
  quality_average: number;
  ascensionist_count: number;
  // From ascents (optional)
  last_climbed_at: string | null;
}

// Cached climb map — avoids re-reading all climbs on every filter change.
// Invalidated by setting to null (e.g. after sync).
let climbCache: Map<string, {
  uuid: string;
  name: string;
  setter_username: string;
  frames: string;
  layout_id: number;
  is_draft: number;
  is_listed: number;
  edge_left: number;
  edge_right: number;
  edge_bottom: number;
  edge_top: number;
  has_aux_hold?: boolean;
  has_aux_hand_hold?: boolean;
}> | null = null;

export function invalidateClimbCache() {
  climbCache = null;
}

/**
 * Normalize Kilter circuit colors to CSS-compatible hex.
 * The API stores colors as 6-char hex without '#' (e.g. "FF0000").
 * Black (000000) is remapped to gray, pure blue to a brighter blue,
 * matching the APK's mapCircuitColorToDisplayColor.
 */
function normalizeCircuitColor(raw: string): string {
  const c = raw.replace(/^#/, "");
  const display = c === "000000" ? "808080" : c === "0000FF" ? "0080FF" : c;
  return /^[0-9a-fA-F]{6}$/.test(display) ? `#${display}` : raw || "#808080";
}

// Circuit cache — maps climb_uuid → list of circuits it belongs to
export interface CircuitInfo {
  uuid: string;
  name: string;
  color: string;
}

let circuitCache: Map<string, CircuitInfo[]> | null = null;
let circuitCacheVersion = 0;

export function invalidateCircuitCache() {
  circuitCache = null;
  circuitCacheVersion++;
}

export function getCircuitCacheVersion() {
  return circuitCacheVersion;
}

/** Load all circuit-climb associations into a Map<climb_uuid, CircuitInfo[]> */
export async function getCircuitMap(): Promise<Map<string, CircuitInfo[]>> {
  if (circuitCache) return circuitCache;
  const db = await getDB();

  const circuits = await db.getAll("circuits");
  const circuitLookup = new Map<string, { name: string; color: string }>();
  for (const c of circuits) {
    circuitLookup.set(c.uuid, { name: c.name, color: normalizeCircuitColor(c.color) });
  }

  const allLinks = await db.getAll("circuits_climbs");
  circuitCache = new Map();
  for (const link of allLinks) {
    const info = circuitLookup.get(link.circuit_uuid);
    if (!info) continue;
    const existing = circuitCache.get(link.climb_uuid) ?? [];
    existing.push({ uuid: link.circuit_uuid, name: info.name, color: info.color });
    circuitCache.set(link.climb_uuid, existing);
  }

  return circuitCache;
}

/** Get all circuits for the current user */
export async function getUserCircuits(userId: number): Promise<Array<{
  uuid: string;
  name: string;
  color: string;
  description: string;
}>> {
  const db = await getDB();
  const rows = await db.getAllFromIndex("circuits", "by-user", userId);
  return rows.map((r) => ({ ...r, color: normalizeCircuitColor(r.color) }));
}

/** Get the set of climb UUIDs belonging to a circuit, or null if no circuit filter */
async function getCircuitClimbUuids(circuitUuid: string | null): Promise<Set<string> | null> {
  if (!circuitUuid) return null;
  const db = await getDB();
  const links = await db.getAllFromIndex("circuits_climbs", "by-circuit", circuitUuid);
  console.log(`[filter-debug] circuit ${circuitUuid}: ${links.length} climbs`);
  return new Set(links.map((l) => l.climb_uuid));
}

/** Get the position of each climb within a circuit (climb_uuid → position) */
export async function getCircuitClimbPositions(circuitUuid: string): Promise<Map<string, number>> {
  const db = await getDB();
  const links = await db.getAllFromIndex("circuits_climbs", "by-circuit", circuitUuid);
  const positions = new Map<string, number>();
  for (const link of links) {
    positions.set(link.climb_uuid, link.position);
  }
  return positions;
}

export interface BetaLinkResult {
  climb_uuid: string;
  link: string;
  foreign_username: string | null;
  angle: number | null;
  is_listed: number;
}

/** Get listed beta links for a climb from IndexedDB */
export async function getBetaLinks(climbUuid: string): Promise<BetaLinkResult[]> {
  const db = await getDB();
  const all = await db.getAllFromIndex("beta_links", "by-climb", climbUuid);
  // is_listed comes as boolean from sync JSON or number from manual writes
  return all.filter((l) => l.is_listed == 1);
}

// Beta climb UUID cache — avoids re-reading all beta_links on every list mount
let betaClimbCache: Set<string> | null = null;

export function invalidateBetaClimbCache() {
  betaClimbCache = null;
}

/** Get the set of climb UUIDs that have at least one listed beta link */
export async function getBetaClimbUuids(): Promise<Set<string>> {
  if (betaClimbCache) return betaClimbCache;
  const db = await getDB();
  const all = await db.getAll("beta_links");
  const uuids = new Set<string>();
  for (const link of all) {
    if (link.is_listed == 1) uuids.add(link.climb_uuid);
  }
  betaClimbCache = uuids;
  return uuids;
}

/** Get sent climb UUIDs and user grades (climb_uuid → difficulty) for a given angle */
export async function getUserClimbGrades(userId: number | null, angle: number): Promise<{
  sentUuids: Set<string>;
  userGrades: Map<string, number>;
}> {
  if (!userId) return { sentUuids: new Set(), userGrades: new Map() };
  const db = await getDB();
  const all = await db.getAllFromIndex("ascents", "by-user", userId);
  const sentUuids = new Set<string>();
  const userGrades = new Map<string, number>();
  const latestAt = new Map<string, string>();
  for (const a of all) {
    if (a.angle !== angle) continue;
    sentUuids.add(a.climb_uuid);
    const prev = latestAt.get(a.climb_uuid);
    if (!prev || a.climbed_at > prev) {
      latestAt.set(a.climb_uuid, a.climbed_at);
      userGrades.set(a.climb_uuid, a.difficulty);
    }
  }
  return { sentUuids, userGrades };
}

// Block cache — avoids re-reading tags on every filter change
let blockCache: Set<string> | null = null;
let blockCacheUserId: number | null = null;

export function invalidateBlockCache() {
  blockCache = null;
  blockCacheUserId = null;
}

/** Get all blocked climb UUIDs for the given user */
export async function getBlockedSet(userId: number | null): Promise<Set<string>> {
  if (!userId) return new Set();
  if (blockCache && blockCacheUserId === userId) return blockCache;
  const db = await getDB();
  const allTags = await db.getAllFromIndex("tags", "by-user", userId);
  blockCache = new Set(
    allTags
      .filter((t) => t.name === "~block" && t.is_listed === 1)
      .map((t) => t.entity_uuid)
  );
  blockCacheUserId = userId;
  return blockCache;
}

async function getClimbMap() {
  if (climbCache) return climbCache;
  const db = await getDB();
  const climbs = await db.getAllFromIndex("climbs", "by-layout", 8);
  climbCache = new Map();
  for (const c of climbs) {
    // Pre-filter: only listed, non-draft climbs that fit 7x10
    if (c.is_draft || !c.is_listed) continue;
    if (c.edge_left <= -44 || c.edge_right >= 44 || c.edge_bottom <= 24 || c.edge_top >= 144) continue;
    climbCache.set(c.uuid, c);
  }
  return climbCache;
}

/** Build user grade overrides, recency set, and logbook sets in one pass */
async function getUserAscentData(userId: number | null, recencyDays: number) {
  let userGrades: Map<string, number> | null = null;
  let recentClimbUuids: Set<string> | null = null;
  const sentUuids = new Set<string>();
  // "tried" = sent OR attempted (bids table)
  const triedUuids = new Set<string>();

  if (!userId) return { userGrades, recentClimbUuids, sentUuids, triedUuids };

  const db = await getDB();
  const [allAscents, allBids] = await Promise.all([
    db.getAllFromIndex("ascents", "by-user", userId),
    db.getAllFromIndex("bids", "by-user", userId),
  ]);

  const latestAt = new Map<string, string>();
  userGrades = new Map();
  for (const a of allAscents) {
    sentUuids.add(a.climb_uuid);
    triedUuids.add(a.climb_uuid);
    const prev = latestAt.get(a.climb_uuid);
    if (!prev || a.climbed_at > prev) {
      latestAt.set(a.climb_uuid, a.climbed_at);
      userGrades.set(a.climb_uuid, a.difficulty);
    }
  }

  // Bids are attempts without sends
  for (const b of allBids) {
    triedUuids.add(b.climb_uuid);
  }

  if (recencyDays > 0) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - recencyDays);
    const cutoffStr = cutoffDate.toISOString().slice(0, 19).replace("T", " ");
    recentClimbUuids = new Set(
      allAscents
        .filter((a) => a.climbed_at >= cutoffStr)
        .map((a) => a.climb_uuid)
    );
  }

  return { userGrades, recentClimbUuids, sentUuids, triedUuids };
}

/**
 * Query climbs matching the current filter state.
 * All filtering happens client-side against IndexedDB.
 */
export async function queryClimbs(
  filters: FilterState,
  userId: number | null,
  blockedUuids?: Set<string>
): Promise<ClimbResult[]> {
  const [db, climbMap, { userGrades, recentClimbUuids, sentUuids, triedUuids }, circuitClimbUuids] = await Promise.all([
    getDB(),
    getClimbMap(),
    getUserAscentData(userId, filters.recencyDays),
    getCircuitClimbUuids(filters.circuitUuid),
  ]);

  const allStats = await db.getAllFromIndex(
    "climb_stats",
    "by-angle",
    filters.angle
  );

  const results: ClimbResult[] = [];

  for (const stats of allStats) {
    const grade = userGrades?.get(stats.climb_uuid) ?? stats.display_difficulty;
    if (grade < filters.minGrade || grade > filters.maxGrade) continue;
    if (stats.quality_average < filters.minQuality) continue;
    if (stats.ascensionist_count < filters.minAscents) continue;
    if (recentClimbUuids?.has(stats.climb_uuid)) continue;
    if (blockedUuids?.has(stats.climb_uuid)) continue;
    if (circuitClimbUuids && !circuitClimbUuids.has(stats.climb_uuid)) continue;
    if (filters.hideSent && sentUuids.has(stats.climb_uuid)) continue;
    if (filters.hideAttempted && triedUuids.has(stats.climb_uuid)) continue;

    const climb = climbMap.get(stats.climb_uuid);
    if (!climb) continue;

    if (filters.usesAuxHolds && !climb.has_aux_hold) continue;
    if (filters.usesAuxHandHolds && !climb.has_aux_hand_hold) continue;

    results.push({
      uuid: climb.uuid,
      name: climb.name,
      setter_username: climb.setter_username,
      frames: climb.frames,
      layout_id: climb.layout_id,
      edge_left: climb.edge_left,
      edge_right: climb.edge_right,
      edge_bottom: climb.edge_bottom,
      edge_top: climb.edge_top,
      angle: stats.angle,
      display_difficulty: stats.display_difficulty,
      benchmark_difficulty: stats.benchmark_difficulty,
      difficulty_average: stats.difficulty_average,
      quality_average: stats.quality_average,
      ascensionist_count: stats.ascensionist_count,
      last_climbed_at: null,
    });
  }

  return results;
}

/**
 * Count matching climbs without loading full climb data.
 */
export async function countMatchingClimbs(
  filters: FilterState,
  userId: number | null,
  blockedUuids?: Set<string>
): Promise<number> {
  const [db, climbMap, { userGrades, recentClimbUuids, sentUuids, triedUuids }, circuitClimbUuids] = await Promise.all([
    getDB(),
    getClimbMap(),
    getUserAscentData(userId, filters.recencyDays),
    getCircuitClimbUuids(filters.circuitUuid),
  ]);

  const allStats = await db.getAllFromIndex(
    "climb_stats",
    "by-angle",
    filters.angle
  );

  // When circuit is selected, start from circuit climbs and look up their stats
  let statsToCheck: typeof allStats;
  if (circuitClimbUuids) {
    const statsMap = new Map(allStats.map((s) => [s.climb_uuid, s]));
    statsToCheck = [];
    for (const uuid of circuitClimbUuids) {
      const s = statsMap.get(uuid);
      if (s) statsToCheck.push(s);
    }
    console.log(`[filter-debug] circuit: ${circuitClimbUuids.size} climbs, ${statsToCheck.length} have stats for angle ${filters.angle}`);
  } else {
    statsToCheck = allStats;
  }

  const funnel = { "0_total": statsToCheck.length, "1_grade": 0, "2_quality": 0, "3_ascents": 0, "4_recency": 0, "5_blocked": 0, "6_climbMap": 0, "7_aux": 0 };

  for (const s of statsToCheck) {
    const grade = userGrades?.get(s.climb_uuid) ?? s.display_difficulty;
    if (grade < filters.minGrade || grade > filters.maxGrade) continue;
    funnel["1_grade"]++;
    if (s.quality_average < filters.minQuality) continue;
    funnel["2_quality"]++;
    if (s.ascensionist_count < filters.minAscents) continue;
    funnel["3_ascents"]++;
    if (recentClimbUuids?.has(s.climb_uuid)) continue;
    funnel["4_recency"]++;
    if (blockedUuids?.has(s.climb_uuid)) continue;
    funnel["5_blocked"]++;
    if (filters.hideSent && sentUuids.has(s.climb_uuid)) continue;
    if (filters.hideAttempted && triedUuids.has(s.climb_uuid)) continue;

    const climb = climbMap.get(s.climb_uuid);
    if (!climb) continue;
    funnel["6_climbMap"]++;

    if (filters.usesAuxHolds && !climb.has_aux_hold) continue;
    if (filters.usesAuxHandHolds && !climb.has_aux_hand_hold) continue;
    funnel["7_aux"]++;
  }

  console.log("[filter-debug] funnel:", funnel);

  return funnel["7_aux"];
}

// ─── Logbook queries ───────────────────────────────────────────────

export interface ActivityEntry {
  type: "send" | "attempt" | "board_light";
  /** UUID of the ascent/bid record (undefined for board_light) */
  uuid?: string;
  climb_uuid: string;
  timestamp: string;
  /** User's graded difficulty (from ascent) */
  difficulty?: number;
  /** Community display difficulty (from climb_stats) */
  display_difficulty?: number;
  angle?: number;
  quality?: number;
  bid_count?: number;
  comment?: string;
  climb_name?: string;
}

export async function getLogbookActivity(userId: number, angle?: number): Promise<ActivityEntry[]> {
  const db = await getDB();
  const [allAscents, allBids, lights] = await Promise.all([
    db.getAllFromIndex("ascents", "by-user", userId),
    db.getAllFromIndex("bids", "by-user", userId),
    db.getAll("board_lights"),
  ]);

  // Filter to current angle if specified
  const ascents = angle != null ? allAscents.filter((a) => a.angle === angle) : allAscents;
  const bids = angle != null ? allBids.filter((b) => b.angle === angle) : allBids;

  // Batch-load community grades for ascents
  const statsCache = new Map<string, number>();
  for (const a of ascents) {
    const key = `${a.climb_uuid}-${a.angle}`;
    if (!statsCache.has(key)) {
      const stats = await db.get("climb_stats", [a.climb_uuid, a.angle]);
      if (stats) statsCache.set(key, stats.display_difficulty);
    }
  }

  // Find the latest user grade per climb+angle (most recent ascent's difficulty
  // is authoritative — if user re-sends and re-grades, all sends use that grade)
  const latestUserGrade = new Map<string, number>();
  const sorted = [...ascents].sort((a, b) => b.climbed_at.localeCompare(a.climbed_at));
  for (const a of sorted) {
    const key = `${a.climb_uuid}-${a.angle}`;
    if (!latestUserGrade.has(key)) {
      latestUserGrade.set(key, a.difficulty);
    }
  }

  const entries: ActivityEntry[] = [];

  for (const a of ascents) {
    const key = `${a.climb_uuid}-${a.angle}`;
    const userGrade = latestUserGrade.get(key) ?? a.difficulty;
    entries.push({
      type: "send",
      uuid: a.uuid,
      climb_uuid: a.climb_uuid,
      timestamp: a.climbed_at,
      difficulty: userGrade,
      display_difficulty: statsCache.get(key),
      angle: a.angle,
      quality: a.quality,
      bid_count: a.bid_count,
      comment: a.comment,
    });
  }

  for (const b of bids) {
    entries.push({
      type: "attempt",
      uuid: b.uuid,
      climb_uuid: b.climb_uuid,
      timestamp: b.climbed_at,
      angle: b.angle,
      bid_count: b.bid_count,
      comment: b.comment,
    });
  }

  for (const l of lights) {
    entries.push({
      type: "board_light",
      climb_uuid: l.climb_uuid,
      timestamp: l.timestamp,
    });
  }

  entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  // Batch resolve climb names
  const uuids = [...new Set(entries.map((e) => e.climb_uuid))];
  const names = await getClimbNames(uuids);
  for (const e of entries) {
    e.climb_name = names.get(e.climb_uuid);
  }

  return entries;
}

export async function getGradeDistribution(userId: number, angle: number): Promise<Map<number, number>> {
  const db = await getDB();
  const allAscents = await db.getAllFromIndex("ascents", "by-user", userId);
  const ascents = allAscents.filter((a) => a.angle === angle);

  // Use latest user grade per climb (most recent ascent is authoritative)
  const latestGrade = new Map<string, number>();
  const sorted = [...ascents].sort((a, b) => b.climbed_at.localeCompare(a.climbed_at));
  for (const a of sorted) {
    if (!latestGrade.has(a.climb_uuid)) {
      latestGrade.set(a.climb_uuid, a.difficulty);
    }
  }

  const counts = new Map<number, number>();
  for (const a of ascents) {
    const grade = latestGrade.get(a.climb_uuid) ?? a.difficulty;
    counts.set(grade, (counts.get(grade) ?? 0) + 1);
  }
  return counts;
}

async function getClimbNames(uuids: string[]): Promise<Map<string, string>> {
  const db = await getDB();
  const map = new Map<string, string>();
  for (const uuid of uuids) {
    const climb = await db.get("climbs", uuid);
    if (climb) map.set(uuid, climb.name);
  }
  return map;
}

/** Load a single ClimbResult by climb UUID + angle for logbook navigation */
export async function getClimbResult(climbUuid: string, angle: number): Promise<ClimbResult | null> {
  const db = await getDB();
  const climb = await db.get("climbs", climbUuid);
  if (!climb) return null;
  const stats = await db.get("climb_stats", [climbUuid, angle]);
  return {
    uuid: climb.uuid,
    name: climb.name,
    setter_username: climb.setter_username,
    frames: climb.frames,
    layout_id: climb.layout_id,
    edge_left: climb.edge_left,
    edge_right: climb.edge_right,
    edge_bottom: climb.edge_bottom,
    edge_top: climb.edge_top,
    angle: stats?.angle ?? angle,
    display_difficulty: stats?.display_difficulty ?? 0,
    benchmark_difficulty: stats?.benchmark_difficulty ?? null,
    difficulty_average: stats?.difficulty_average ?? 0,
    quality_average: stats?.quality_average ?? 0,
    ascensionist_count: stats?.ascensionist_count ?? 0,
    last_climbed_at: null,
  };
}

/** Search climbs by name or setter, returns up to 100 results sorted by popularity */
export async function searchClimbs(query: string, angle: number): Promise<ClimbResult[]> {
  const climbMap = await getClimbMap();
  const db = await getDB();
  const q = query.toLowerCase();
  const results: ClimbResult[] = [];

  const allStats = await db.getAllFromIndex("climb_stats", "by-angle", angle);
  const statsMap = new Map<string, typeof allStats[0]>();
  for (const s of allStats) {
    statsMap.set(s.climb_uuid, s);
  }

  for (const [uuid, climb] of climbMap) {
    if (!climb.name.toLowerCase().includes(q) && !climb.setter_username.toLowerCase().includes(q)) continue;
    const stats = statsMap.get(uuid);
    if (!stats) continue;
    results.push({
      uuid,
      name: climb.name,
      setter_username: climb.setter_username,
      frames: climb.frames,
      layout_id: climb.layout_id,
      edge_left: climb.edge_left,
      edge_right: climb.edge_right,
      edge_bottom: climb.edge_bottom,
      edge_top: climb.edge_top,
      angle: stats.angle,
      display_difficulty: stats.display_difficulty,
      benchmark_difficulty: stats.benchmark_difficulty,
      difficulty_average: stats.difficulty_average,
      quality_average: stats.quality_average,
      ascensionist_count: stats.ascensionist_count,
      last_climbed_at: null,
    });
  }

  results.sort((a, b) => b.ascensionist_count - a.ascensionist_count);
  return results.slice(0, 100);
}

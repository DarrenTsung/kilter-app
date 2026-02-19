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

/** Build user grade overrides and recency set in one pass */
async function getUserAscentData(userId: number | null, recencyDays: number) {
  let userGrades: Map<string, number> | null = null;
  let recentClimbUuids: Set<string> | null = null;

  if (!userId) return { userGrades, recentClimbUuids };

  const db = await getDB();
  const allAscents = await db.getAllFromIndex("ascents", "by-user", userId);

  const latestAt = new Map<string, string>();
  userGrades = new Map();
  for (const a of allAscents) {
    const prev = latestAt.get(a.climb_uuid);
    if (!prev || a.climbed_at > prev) {
      latestAt.set(a.climb_uuid, a.climbed_at);
      userGrades.set(a.climb_uuid, a.difficulty);
    }
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

  return { userGrades, recentClimbUuids };
}

/**
 * Query climbs matching the current filter state.
 * All filtering happens client-side against IndexedDB.
 */
export async function queryClimbs(
  filters: FilterState,
  userId: number | null,
  dislikedUuids?: Set<string>
): Promise<ClimbResult[]> {
  const [db, climbMap, { userGrades, recentClimbUuids }] = await Promise.all([
    getDB(),
    getClimbMap(),
    getUserAscentData(userId, filters.recencyDays),
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
    if (dislikedUuids?.has(stats.climb_uuid)) continue;

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
  dislikedUuids?: Set<string>
): Promise<number> {
  const [db, climbMap, { userGrades, recentClimbUuids }] = await Promise.all([
    getDB(),
    getClimbMap(),
    getUserAscentData(userId, filters.recencyDays),
  ]);

  const allStats = await db.getAllFromIndex(
    "climb_stats",
    "by-angle",
    filters.angle
  );

  let count = 0;

  for (const s of allStats) {
    const grade = userGrades?.get(s.climb_uuid) ?? s.display_difficulty;
    if (grade < filters.minGrade || grade > filters.maxGrade) continue;
    if (s.quality_average < filters.minQuality) continue;
    if (s.ascensionist_count < filters.minAscents) continue;
    if (recentClimbUuids?.has(s.climb_uuid)) continue;
    if (dislikedUuids?.has(s.climb_uuid)) continue;

    const climb = climbMap.get(s.climb_uuid);
    if (!climb) continue;

    if (filters.usesAuxHolds && !climb.has_aux_hold) continue;
    if (filters.usesAuxHandHolds && !climb.has_aux_hand_hold) continue;

    count++;
  }

  return count;
}

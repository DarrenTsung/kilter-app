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

/**
 * Query climbs matching the current filter state.
 * All filtering happens client-side against IndexedDB.
 */
export async function queryClimbs(
  filters: FilterState,
  userId: number | null,
  dislikedUuids?: Set<string>
): Promise<ClimbResult[]> {
  const db = await getDB();

  // 1. Get all climb_stats for the selected angle
  const allStats = await db.getAllFromIndex(
    "climb_stats",
    "by-angle",
    filters.angle
  );

  // 2. Filter stats by grade, quality, ascensionist count
  const filteredStats = allStats.filter(
    (s) =>
      s.display_difficulty >= filters.minGrade &&
      s.display_difficulty <= filters.maxGrade &&
      s.quality_average >= filters.minQuality &&
      s.ascensionist_count >= filters.minAscents
  );

  // 3. Build recency exclusion set
  let recentClimbUuids: Set<string> | null = null;
  if (filters.recencyDays > 0 && userId) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - filters.recencyDays);
    const cutoffStr = cutoffDate.toISOString().slice(0, 19).replace("T", " ");

    const allAscents = await db.getAllFromIndex("ascents", "by-user", userId);
    recentClimbUuids = new Set(
      allAscents
        .filter((a) => a.climbed_at >= cutoffStr)
        .map((a) => a.climb_uuid)
    );
  }

  // 4. Look up each climb and apply remaining filters
  const results: ClimbResult[] = [];

  for (const stats of filteredStats) {
    // Skip recently climbed or disliked
    if (recentClimbUuids?.has(stats.climb_uuid)) continue;
    if (dislikedUuids?.has(stats.climb_uuid)) continue;

    const climb = await db.get("climbs", stats.climb_uuid);
    if (!climb) continue;

    // Must be listed, not a draft, match homewall layout, and fit on 7x10
    if (climb.is_draft || !climb.is_listed) continue;
    if (climb.layout_id !== 8) continue;
    // 7x10 product_size edges: L=-44 R=44 B=24 T=144
    // Strict inequality — climb edges must be strictly inside product size bounds
    if (climb.edge_left <= -44 || climb.edge_right >= 44 || climb.edge_bottom <= 24 || climb.edge_top >= 144) continue;

    // Aux hold filters
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
      last_climbed_at: null, // TODO: populate from ascents
    });
  }

  return results;
}

/**
 * Count matching climbs without loading full climb data.
 * Faster than queryClimbs for the live count indicator.
 */
export async function countMatchingClimbs(
  filters: FilterState,
  userId: number | null,
  dislikedUuids?: Set<string>
): Promise<number> {
  const db = await getDB();

  const allStats = await db.getAllFromIndex(
    "climb_stats",
    "by-angle",
    filters.angle
  );

  let count = 0;
  let recentClimbUuids: Set<string> | null = null;

  if (filters.recencyDays > 0 && userId) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - filters.recencyDays);
    const cutoffStr = cutoffDate.toISOString().slice(0, 19).replace("T", " ");

    const allAscents = await db.getAllFromIndex("ascents", "by-user", userId);
    recentClimbUuids = new Set(
      allAscents
        .filter((a) => a.climbed_at >= cutoffStr)
        .map((a) => a.climb_uuid)
    );
  }

  const needsAuxCheck = filters.usesAuxHolds || filters.usesAuxHandHolds;

  for (const s of allStats) {
    if (
      s.display_difficulty < filters.minGrade ||
      s.display_difficulty > filters.maxGrade ||
      s.quality_average < filters.minQuality ||
      s.ascensionist_count < filters.minAscents
    )
      continue;

    if (recentClimbUuids?.has(s.climb_uuid)) continue;
    if (dislikedUuids?.has(s.climb_uuid)) continue;

    const climb = await db.get("climbs", s.climb_uuid);
    if (!climb || climb.is_draft || !climb.is_listed) continue;
    if (climb.layout_id !== 8) continue;
    if (climb.edge_left <= -44 || climb.edge_right >= 44 || climb.edge_bottom <= 24 || climb.edge_top >= 144) continue;
    if (filters.usesAuxHolds && !climb.has_aux_hold) continue;
    if (filters.usesAuxHandHolds && !climb.has_aux_hand_hold) continue;

    count++;
  }

  return count;
}

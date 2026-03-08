import { getDB } from "./index";

const CONSOLIDATION_MS = 60_000; // 1 minute — merge tag events on same climb

/**
 * Log a tag activity (circuit add/remove, block) for the logbook.
 * Consolidates with a recent entry on the same climb if within 1 minute.
 */
export async function logTagActivity(
  type: "circuit_add" | "circuit_remove" | "block",
  climbUuid: string,
  detail: string
): Promise<void> {
  const db = await getDB();
  const now = new Date();
  const timestamp =
    now.toLocaleString("sv").slice(0, 19) +
    "." + String(now.getMilliseconds()).padStart(3, "0") + "000";

  // Check for a recent entry on the same climb to consolidate
  const recent = await db.getAllFromIndex("activity_log", "by-climb", climbUuid);
  const cutoff = now.getTime() - CONSOLIDATION_MS;

  for (const entry of recent) {
    const entryTime = new Date(entry.timestamp.replace(" ", "T")).getTime();
    if (entryTime >= cutoff) {
      // Consolidate — append detail to existing entry
      const merged = entry.detail.includes(detail)
        ? entry.detail
        : `${entry.detail}, ${detail}`;
      await db.put("activity_log", {
        ...entry,
        detail: merged,
        timestamp, // update to latest time
      });
      return;
    }
  }

  // No recent entry — create new
  await db.add("activity_log", {
    type,
    climb_uuid: climbUuid,
    detail,
    timestamp,
  });
}

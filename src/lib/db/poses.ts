import { getDB } from "./index";
import type { SavedPose } from "../bodyModel";

/**
 * Climber poses are stored one record per climb, keyed by the climb uuid. For a
 * climb that has not been published yet that uuid is the local draft id, so
 * poses survive the draft being saved.
 */
export async function loadPoses(climbUuid: string): Promise<SavedPose[]> {
  if (!climbUuid) return [];
  try {
    const db = await getDB();
    const row = await db.get("climb_poses", climbUuid);
    return row?.poses ?? [];
  } catch (err) {
    console.error("[poses] Failed to load poses:", err);
    return [];
  }
}

export async function persistPoses(
  climbUuid: string,
  poses: SavedPose[]
): Promise<void> {
  if (!climbUuid) return;
  try {
    const db = await getDB();
    if (poses.length === 0) {
      await db.delete("climb_poses", climbUuid);
      return;
    }
    await db.put("climb_poses", { climb_uuid: climbUuid, poses });
  } catch (err) {
    console.error("[poses] Failed to save poses:", err);
  }
}

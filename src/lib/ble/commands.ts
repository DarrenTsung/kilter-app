/**
 * High-level BLE API: resolve climb frames → LED instructions → encode → write.
 */

import { getDB } from "@/lib/db";
import { parseFrames } from "@/lib/utils/frames";
import { buildPacket, type LED } from "./protocol";
import { writePacket, scheduleAutoDisconnect } from "./connection";
import { useBleStore } from "@/store/bleStore";

const PRODUCT_SIZE_ID = 17; // 7×10 homewall
const BOARD_LIGHT_DEBOUNCE_MS = 30_000; // 30s — ignore rapid light-ups in logbook

let pendingBoardLight: { climbUuid: string; timestamp: string } | null = null;
let pendingBoardLightTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Resolve a frames string into LED positions + colors.
 * Uses IndexedDB: placements → hole_id, leds → position, placement_roles → led_color.
 */
async function resolveFramesToLEDs(frames: string): Promise<LED[]> {
  const holds = parseFrames(frames);
  if (holds.length === 0) return [];

  const db = await getDB();
  const leds: LED[] = [];

  for (const { placementId, roleId } of holds) {
    // placement → hole_id
    const placement = await db.get("placements", placementId);
    if (!placement) continue;

    // hole_id + product_size_id → LED position
    const ledRows = await db.getAllFromIndex(
      "leds",
      "by-hole",
      placement.hole_id
    );
    const led = ledRows.find((l) => l.product_size_id === PRODUCT_SIZE_ID);
    if (!led) continue;

    // roleId → led_color
    const role = await db.get("placement_roles", roleId);
    if (!role?.led_color) continue;

    leds.push({ position: led.position, color: role.led_color });
  }

  return leds;
}

/**
 * Light up a climb on the physical board.
 * Resolves LED data, builds the protocol packet, writes over BLE,
 * and schedules auto-disconnect if enabled.
 */
// Debug: record frames sent for testing
declare global {
  interface Window {
    __bleSentFrames?: string[];
  }
}

export async function lightUpClimb(frames: string, climbUuid?: string): Promise<void> {
  // Record for test verification
  if (typeof window !== "undefined") {
    window.__bleSentFrames = window.__bleSentFrames ?? [];
    window.__bleSentFrames.push(frames);
  }

  const store = useBleStore.getState();
  if (store.isSending) return;

  store.setSending(true);
  try {
    const leds = await resolveFramesToLEDs(frames);
    if (leds.length === 0) return;

    const packet = buildPacket(leds, store.apiLevel);
    await writePacket(packet);
    scheduleAutoDisconnect();

    // Debounce board_lights for logbook — only record a light-up if
    // it stays on the board for 30s without being replaced. This avoids
    // littering history when swiping through cards quickly.
    if (climbUuid) {
      if (pendingBoardLightTimer) clearTimeout(pendingBoardLightTimer);

      const now = new Date();
      const timestamp =
        now.toLocaleString("sv").slice(0, 19) +
        "." + String(now.getMilliseconds()).padStart(3, "0") + "000";

      pendingBoardLight = { climbUuid, timestamp };
      pendingBoardLightTimer = setTimeout(async () => {
        if (!pendingBoardLight) return;
        try {
          const db = await getDB();
          await db.put("board_lights", {
            climb_uuid: pendingBoardLight.climbUuid,
            timestamp: pendingBoardLight.timestamp,
          });
        } catch (err) {
          console.error("[ble] Failed to write board_light:", err);
        }
        pendingBoardLight = null;
        pendingBoardLightTimer = null;
      }, BOARD_LIGHT_DEBOUNCE_MS);
    }
  } finally {
    useBleStore.getState().setSending(false);
  }
}

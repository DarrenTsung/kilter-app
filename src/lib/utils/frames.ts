export interface FrameHold {
  placementId: number;
  roleId: number;
}

/**
 * Parse a frames string like "p123r14p456r15p789r13" into structured holds.
 */
export function parseFrames(frames: string): FrameHold[] {
  if (!frames) return [];

  const holds: FrameHold[] = [];
  const parts = frames.split("p").filter(Boolean);

  for (const part of parts) {
    const [placementStr, roleStr] = part.split("r");
    if (placementStr && roleStr) {
      holds.push({
        placementId: parseInt(placementStr, 10),
        roleId: parseInt(roleStr, 10),
      });
    }
  }

  return holds;
}

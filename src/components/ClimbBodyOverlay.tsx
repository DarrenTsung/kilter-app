"use client";

import { useEffect, useState } from "react";
import { BodyPositioner } from "./BodyPositioner";
import { loadOverlayGeometry } from "./BoardView";
import { BOARD_BOUNDS, boardSpacing } from "@/lib/boardGeometry";
import type { BodyHold } from "@/lib/bodyModel";

interface Geometry {
  holds: BodyHold[];
  imgWidth: number;
  imgHeight: number;
}

/**
 * Body overlay for a climb that is *not* being edited — the randomizer deck and
 * anywhere else a read-only board is shown. Loads the climb's holds and the
 * board image size, then hands them to the shared BodyPositioner.
 *
 * Poses are still saved against the climb uuid, so a pose you sketch while
 * browsing shows up again if you open the same climb in the editor.
 */
export function ClimbBodyOverlay({
  frames,
  climbUuid,
  onClose,
}: {
  frames: string;
  climbUuid: string;
  onClose: () => void;
}) {
  const [geo, setGeo] = useState<Geometry | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadOverlayGeometry(frames).then((g) => {
      if (!cancelled) setGeo(g);
    });
    return () => {
      cancelled = true;
    };
  }, [frames]);

  if (!geo) return null;

  const { xSpacing, ySpacing } = boardSpacing(geo.imgWidth, geo.imgHeight);

  return (
    <BodyPositioner
      holds={geo.holds}
      climbUuid={climbUuid}
      board={BOARD_BOUNDS}
      imgWidth={geo.imgWidth}
      imgHeight={geo.imgHeight}
      xSpacing={xSpacing}
      ySpacing={ySpacing}
      onClose={onClose}
      className="rounded-xl p-3"
    />
  );
}

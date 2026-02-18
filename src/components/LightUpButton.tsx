"use client";

import { useBleStore } from "@/store/bleStore";
import { requestConnection } from "@/lib/ble/connection";
import { lightUpClimb } from "@/lib/ble/commands";

export function LightUpButton({ frames }: { frames: string }) {
  const { status, isSending } = useBleStore();

  function handleTap() {
    if (isSending || status === "scanning" || status === "connecting") return;

    if (status === "connected") {
      lightUpClimb(frames);
    } else {
      // disconnected or error — open device picker
      requestConnection();
    }
  }

  const { fill, pulse } = getIconStyle(status, isSending);

  return (
    <button
      onClick={handleTap}
      className="flex items-center justify-center rounded-full p-2 transition-colors hover:bg-neutral-700/50 active:bg-neutral-700"
      aria-label="Light up board"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill={fill}
        className={`h-6 w-6 ${pulse ? "animate-pulse" : ""}`}
      >
        <path d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z" />
      </svg>
    </button>
  );
}

function getIconStyle(
  status: string,
  isSending: boolean
): { fill: string; pulse: boolean } {
  if (isSending) return { fill: "#4ade80", pulse: true }; // green pulse
  switch (status) {
    case "scanning":
    case "connecting":
      return { fill: "#60a5fa", pulse: true }; // blue pulse
    case "connected":
      return { fill: "#fbbf24", pulse: false }; // amber
    case "error":
      return { fill: "#f87171", pulse: false }; // red
    default:
      return { fill: "#737373", pulse: false }; // gray
  }
}

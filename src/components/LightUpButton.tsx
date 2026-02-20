"use client";

import { useState, useEffect, useRef } from "react";
import { useBleStore } from "@/store/bleStore";
import { requestConnection, disconnect } from "@/lib/ble/connection";
import { lightUpClimb } from "@/lib/ble/commands";

export function LightUpButton({ frames, className }: { frames: string; className?: string }) {
  const { status, isSending } = useBleStore();
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset confirming state if BLE disconnects externally
  useEffect(() => {
    if (status !== "connected") setConfirmingDisconnect(false);
  }, [status]);

  // Clean up timer on unmount
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  function handleTap() {
    if (isSending || status === "scanning" || status === "connecting") return;

    if (status === "connected") {
      if (confirmingDisconnect) {
        // Second tap — disconnect
        if (timerRef.current) clearTimeout(timerRef.current);
        setConfirmingDisconnect(false);
        disconnect();
      } else {
        // First tap — enter confirm state, auto-reset after 2s
        setConfirmingDisconnect(true);
        timerRef.current = setTimeout(() => setConfirmingDisconnect(false), 2000);
      }
    } else {
      // disconnected or error — open device picker
      requestConnection();
    }
  }

  const { fill, pulse } = getIconStyle(status, isSending, confirmingDisconnect);

  return (
    <button
      onClick={handleTap}
      className={className ?? `flex items-center justify-center rounded-lg border p-2 transition-colors ${
        confirmingDisconnect
          ? "border-red-500/50 bg-red-600/20 active:bg-red-600/30"
          : "border-neutral-600 hover:bg-neutral-700/50 active:bg-neutral-700"
      }`}
      aria-label={confirmingDisconnect ? "Confirm disconnect" : "Light up board"}
    >
      {confirmingDisconnect ? (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill={fill}
          className="h-5 w-5"
        >
          <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
        </svg>
      ) : (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill={fill}
          className={`h-5 w-5 ${pulse ? "animate-pulse" : ""}`}
        >
          <path d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z" />
        </svg>
      )}
    </button>
  );
}

function getIconStyle(
  status: string,
  isSending: boolean,
  confirmingDisconnect: boolean
): { fill: string; pulse: boolean } {
  if (confirmingDisconnect) return { fill: "#f87171", pulse: false }; // red X
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

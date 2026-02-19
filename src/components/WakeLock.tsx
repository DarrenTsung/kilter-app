"use client";

import { useEffect } from "react";

export function WakeLock() {
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;

    async function acquire() {
      try {
        lock = await navigator.wakeLock.request("screen");
      } catch {
        // Not supported or permission denied
      }
    }

    acquire();

    // Re-acquire when the page becomes visible again (lock is released on tab hide)
    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        acquire();
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      lock?.release();
    };
  }, []);

  return null;
}

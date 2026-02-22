"use client";

import { useEffect } from "react";
import { useTabStore } from "@/store/tabStore";
import { RandomizerContent } from "./RandomizerContent";
import { SettingsContent } from "./SettingsContent";
import { LogbookContent } from "./LogbookContent";

export function TabContent() {
  const activeTab = useTabStore((s) => s.activeTab);

  // Sync initial tab from URL on first load
  useEffect(() => {
    const path = window.location.pathname;
    if (path.startsWith("/settings")) {
      useTabStore.getState().setTab("settings");
    } else if (path.startsWith("/logbook")) {
      useTabStore.getState().setTab("logbook");
    } else {
      useTabStore.getState().setTab("randomizer");
    }
  }, []);

  return (
    <>
      <div className={activeTab === "randomizer" ? "h-full" : "hidden"}>
        <RandomizerContent />
      </div>
      <div className={activeTab === "logbook" ? "h-full overflow-y-auto" : "hidden"}>
        <LogbookContent />
      </div>
      <div className={activeTab === "settings" ? "h-full overflow-y-auto" : "hidden"}>
        <SettingsContent />
      </div>
    </>
  );
}

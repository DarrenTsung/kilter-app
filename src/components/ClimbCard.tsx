"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import type { ClimbResult } from "@/lib/db/queries";
import { difficultyToGrade, useFilterStore } from "@/store/filterStore";
import { useAuthStore } from "@/store/authStore";
import { useDeckStore } from "@/store/deckStore";
import { getDB } from "@/lib/db";
import { getCircuitMap, getCircuitMapSync, invalidateBlockCache, getBetaLinks, getClimbsBySetter, getClimbsByCircuit, type CircuitInfo, type BetaLinkResult } from "@/lib/db/queries";
import { saveTag, fetchClimbBeta, checkLinksValid, logAscent, logBid } from "@/lib/api/aurora";
import { BoardView } from "./BoardView";
import { LightUpButton } from "./LightUpButton";
import { AscentModal } from "./AscentModal";
import { CircuitPicker } from "./CircuitPicker";
import { ForkModal } from "./ForkModal";
import { useTabStore } from "@/store/tabStore";
import { getForkIndex } from "@/lib/db/queries";

interface UserAscentInfo {
  sendCount: number;
  attemptCount: number;
  latestDifficulty: number | null;
  latestClimbedAt: string | null;
}

function useUserAscents(climbUuid: string, angle: number): UserAscentInfo | null {
  const userId = useAuthStore((s) => s.userId);
  const loggedUuids = useDeckStore((s) => s.loggedUuids);
  const [info, setInfo] = useState<UserAscentInfo | null>(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    async function load() {
      const db = await getDB();
      const [allAscents, allBids] = await Promise.all([
        db.getAllFromIndex("ascents", "by-climb", climbUuid),
        db.getAllFromIndex("bids", "by-climb", climbUuid),
      ]);
      const sends = allAscents
        .filter((a) => a.user_id === userId && a.angle === angle)
        .sort((a, b) => b.climbed_at.localeCompare(a.climbed_at));
      const attempts = allBids
        .filter((b) => b.user_id === userId && b.angle === angle && b.is_listed !== 0);

      if (!cancelled) {
        setInfo({
          sendCount: sends.length,
          attemptCount: attempts.length,
          latestDifficulty: sends.length > 0 ? sends[0].difficulty : null,
          latestClimbedAt: sends.length > 0 ? sends[0].climbed_at : null,
        });
      }
    }
    load();
    return () => { cancelled = true; };
  }, [climbUuid, angle, userId, loggedUuids]);

  return info;
}

function useClimbCircuits(climbUuid: string): [CircuitInfo[], () => void] {
  // Initialize synchronously from cache when available (loaded by ListView)
  const [circuits, setCircuits] = useState<CircuitInfo[]>(() => {
    const cached = getCircuitMapSync();
    return cached ? (cached.get(climbUuid) ?? []) : [];
  });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getCircuitMap().then((map) => {
      if (!cancelled) setCircuits(map.get(climbUuid) ?? []);
    });
    return () => { cancelled = true; };
  }, [climbUuid, version]);

  const refresh = () => setVersion((v) => v + 1);
  return [circuits, refresh];
}

function useBetaLinks(climbUuid: string): BetaLinkResult[] | null {
  const token = useAuthStore((s) => s.token);
  const [links, setLinks] = useState<BetaLinkResult[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Show synced data instantly for fast badge
    getBetaLinks(climbUuid).then((local) => {
      if (!cancelled) setLinks(local);
    });

    // Merge local + API, then validate against Instagram
    if (token) {
      Promise.all([
        getBetaLinks(climbUuid),
        fetchClimbBeta(token, climbUuid),
      ]).then(([local, remote]) => {
        if (cancelled) return;
        const localByLink = new Map(local.map((l) => [l.link, l]));
        const seen = new Set<string>();
        const merged: BetaLinkResult[] = [];
        for (const r of remote) {
          seen.add(r.link);
          const enriched = localByLink.get(r.link);
          merged.push({
            climb_uuid: r.climb_uuid,
            link: r.link,
            foreign_username: enriched?.foreign_username ?? r.foreign_username ?? null,
            angle: r.angle,
            is_listed: 1,
          });
        }
        for (const l of local) {
          if (!seen.has(l.link)) merged.push(l);
        }
        setLinks(merged);

        // Validate links are still publicly accessible (only on Wi-Fi to avoid many requests on mobile data)
        const conn = (navigator as unknown as { connection?: { type?: string } }).connection;
        const isWifi = !conn || conn.type === "wifi" || conn.type === undefined;
        if (isWifi) {
          const urls = merged.map((l) => l.link);
          checkLinksValid(urls).then((validSet) => {
            if (cancelled) return;
            setLinks((prev) => prev?.filter((l) => validSet.has(l.link)) ?? null);
          });
        }
      });
    }

    return () => { cancelled = true; };
  }, [climbUuid, token]);

  return links;
}

export function ClimbCard({ climb }: { climb: ClimbResult }) {
  const [showAscent, setShowAscent] = useState(false);
  const [showCircuits, setShowCircuits] = useState(false);
  const [showBeta, setShowBeta] = useState(false);
  const [showForks, setShowForks] = useState(false);
  const [forkCount, setForkCount] = useState(0);
  const [disliking, setDisliking] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [showLogMenu, setShowLogMenu] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const { isLoggedIn, token, userId } = useAuthStore();
  const angle = useFilterStore((s) => s.angle);
  const markLogged = useDeckStore((s) => s.markLogged);
  const removeClimb = useDeckStore((s) => s.removeClimb);
  const openListFromDeck = useDeckStore((s) => s.openListFromDeck);
  const setTab = useTabStore((s) => s.setTab);
  const setLogbookFilterClimb = useTabStore((s) => s.setLogbookFilterClimb);
  const ascentInfo = useUserAscents(climb.uuid, climb.angle);
  const [circuits, refreshCircuits] = useClimbCircuits(climb.uuid);
  const betaLinks = useBetaLinks(climb.uuid);

  useEffect(() => {
    getForkIndex().then((index) => {
      setForkCount((index.get(climb.uuid) ?? []).length);
    });
  }, [climb.uuid]);

  // Wait for essential async data before showing card to avoid layout flicker.
  // ascentInfo starts null (loading), circuits starts [] (loading from cache).
  // betaLinks can load later (not essential for initial layout).
  const ready = ascentInfo !== null;

  async function handleSetterTap() {
    const climbs = await getClimbsBySetter(climb.setter_username, angle);
    if (climbs.length === 0) return;
    useFilterStore.getState().setSortBy("grade");
    window.history.pushState({ view: "list", fromDeck: true }, "");
    openListFromDeck(climbs, climb.uuid);
  }

  async function handleCircuitTap(circuitUuid: string) {
    const climbs = await getClimbsByCircuit(circuitUuid, angle);
    if (climbs.length === 0) return;
    useFilterStore.getState().setSortBy("circuit");
    window.history.pushState({ view: "list", fromDeck: true }, "");
    openListFromDeck(climbs, climb.uuid);
  }

  async function doBlock() {
    setDisliking(true);
    setConfirmBlock(false);
    if (userId) {
      const db = await getDB();
      await db.put("tags", {
        entity_uuid: climb.uuid,
        user_id: userId,
        name: "~block",
        is_listed: 1,
      });
      invalidateBlockCache();
    }
    setTimeout(() => removeClimb(climb.uuid), 150);
    if (token && userId) {
      saveTag(token, userId, climb.uuid, true).catch(console.error);
    }
  }

  async function doQuickSend() {
    if (!token || !userId || !ascentInfo) return;
    setShowLogMenu(false);
    try {
      const uuid = await logAscent(token, userId, {
        climb_uuid: climb.uuid,
        angle: climb.angle,
        bid_count: 1,
        quality: 3,
        difficulty: ascentInfo.latestDifficulty ?? Math.round(climb.display_difficulty),
        comment: "",
      });
      const db = await getDB();
      const now = new Date().toLocaleString("sv").slice(0, 19);
      await db.put("ascents", {
        uuid,
        climb_uuid: climb.uuid,
        angle: climb.angle,
        is_mirror: 0,
        user_id: userId,
        attempt_id: 0,
        bid_count: 1,
        quality: 3,
        difficulty: ascentInfo.latestDifficulty ?? Math.round(climb.display_difficulty),
        is_benchmark: 0,
        comment: "",
        climbed_at: now,
        created_at: now,
      });
      markLogged(climb.uuid);
      setToast({ type: "success", message: "Sent!" });
    } catch (err) {
      setToast({ type: "error", message: err instanceof Error ? err.message : "Failed to log send" });
    }
  }

  async function doLogAttempt() {
    if (!token || !userId) return;
    setShowLogMenu(false);
    try {
      const uuid = await logBid(token, userId, {
        climb_uuid: climb.uuid,
        angle: climb.angle,
        bid_count: 1,
        comment: "",
      });
      const db = await getDB();
      const now = new Date().toLocaleString("sv").slice(0, 19);
      await db.put("bids", {
        uuid,
        climb_uuid: climb.uuid,
        angle: climb.angle,
        is_mirror: 0,
        user_id: userId,
        bid_count: 1,
        comment: "",
        climbed_at: now,
      });
      markLogged(climb.uuid);
      setToast({ type: "success", message: "Logged attempt!" });
    } catch (err) {
      setToast({ type: "error", message: err instanceof Error ? err.message : "Failed to log attempt" });
    }
  }

  if (!ready) {
    return (
      <div className="rounded-2xl border border-neutral-500/30 bg-gradient-to-b from-[#323232] via-[#222222] to-[#1c1c1c]" style={{ aspectRatio: "9 / 16" }} />
    );
  }

  return (
    <div className="flex flex-col justify-end gap-3 rounded-2xl border border-neutral-500/30 bg-gradient-to-b from-[#323232] via-[#222222] to-[#1c1c1c] px-2 py-2" style={{ aspectRatio: "9 / 16" }}>
      {/* Header */}
      <div className="px-0">
        <h2 className="flex items-center gap-1.5 text-xl font-normal leading-tight py-2">
          {climb.name}
          {ascentInfo && ascentInfo.sendCount > 0 && (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="h-5 w-5 shrink-0 text-white"
            >
              <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
            </svg>
          )}
        </h2>
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {/* Grade — strikethrough + user grade if different */}
          {ascentInfo?.latestDifficulty != null &&
            difficultyToGrade(ascentInfo.latestDifficulty) !== difficultyToGrade(climb.display_difficulty) ? (
            <>
              <StatBadge
                label={difficultyToGrade(climb.display_difficulty)}
                variant="grade"
                strikethrough
              />
              <StatBadge
                label={difficultyToGrade(ascentInfo.latestDifficulty)}
                variant="user-grade"
              />
            </>
          ) : (
            <StatBadge
              label={difficultyToGrade(climb.display_difficulty)}
              variant="grade"
            />
          )}
          {climb.benchmark_difficulty && (
            <StatBadge
              label={`BM ${difficultyToGrade(climb.benchmark_difficulty)}`}
              variant="benchmark"
            />
          )}
          <StatBadge
            label={`${climb.quality_average.toFixed(1)} ★`}
            variant="quality"
          />
          <StatBadge
            label={`${climb.ascensionist_count} sends`}
            variant="default"
          />
          <span className="text-xs text-neutral-500">
            by <button onClick={handleSetterTap} className="active:text-neutral-300">{climb.setter_username}</button>
          </span>
        </div>
        {(ascentInfo || circuits.length > 0) && (
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {ascentInfo && (
              ascentInfo.sendCount === 0 ? (
                <>
                  <StatBadge label="Not Sent" variant="default" />
                  {ascentInfo.attemptCount > 0 && (
                    <button className="flex" onClick={() => { window.history.pushState({ from: "deck" }, "", "/logbook"); setLogbookFilterClimb(climb.uuid); setTab("logbook"); }}>
                      <StatBadge
                        label={`${ascentInfo.attemptCount} attempt${ascentInfo.attemptCount > 1 ? "s" : ""}`}
                        variant="attempted"
                      />
                    </button>
                  )}
                </>
              ) : (
                <>
                  <button className="flex" onClick={() => { window.history.pushState({ from: "deck" }, "", "/logbook"); setLogbookFilterClimb(climb.uuid); setTab("logbook"); }}>
                    <StatBadge
                      label={`${ascentInfo.sendCount} send${ascentInfo.sendCount > 1 ? "s" : ""} (you)`}
                      variant="sent"
                    />
                  </button>
                  {ascentInfo.latestClimbedAt && (
                    <button className="flex" onClick={() => { window.history.pushState({ from: "deck" }, "", "/logbook"); setLogbookFilterClimb(climb.uuid); setTab("logbook"); }}>
                      <StatBadge
                        label={daysAgoLabel(ascentInfo.latestClimbedAt)}
                        variant="default"
                      />
                    </button>
                  )}
                </>
              )
            )}
            {circuits.map((c) => (
              <button
                key={c.uuid}
                className="flex rounded px-1.5 py-0.5 text-xs font-bold text-white/90"
                style={{ backgroundColor: c.color || "#555" }}
                onClick={() => handleCircuitTap(c.uuid)}
              >
                {c.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Board visualization — fills remaining space */}
      <BoardView
        frames={climb.frames}
        className="min-h-0 rounded-xl"
      />

      {/* Bottom action row */}
      <div className="flex items-center gap-3">
        <div className="flex overflow-visible rounded-xl border border-neutral-600">
          <LightUpButton
            frames={climb.frames}
            className="flex items-center justify-center rounded-l-xl px-4 py-3.5 text-neutral-400 transition-colors hover:bg-neutral-700"
          />
          <button
            onClick={() => setShowForks(true)}
            className="relative flex items-center justify-center border-l border-neutral-600 px-5 py-3.5 text-neutral-400 transition-colors hover:bg-neutral-700"
            aria-label="Forks"
          >
            <span className="relative">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M9,7.82929429 L9,12 L12,12 C13.6568542,12 15,10.6568542 15,9 L15,7.82929429 C13.8348076,7.41745788 13,6.30621883 13,5 C13,3.34314575 14.3431458,2 16,2 C17.6568542,2 19,3.34314575 19,5 C19,6.30621883 18.1651924,7.41745788 17,7.82929429 L17,9 C17,11.7614237 14.7614237,14 12,14 L9,14 L9,16.1707057 C10.1651924,16.5825421 11,17.6937812 11,19 C11,20.6568542 9.65685425,22 8,22 C6.34314575,22 5,20.6568542 5,19 C5,17.6937812 5.83480763,16.5825421 7,16.1707057 L7,7.82929429 C5.83480763,7.41745788 5,6.30621883 5,5 C5,3.34314575 6.34314575,2 8,2 C9.65685425,2 11,3.34314575 11,5 C11,6.30621883 10.1651924,7.41745788 9,7.82929429 Z M8,20 C8.55228475,20 9,19.5522847 9,19 C9,18.4477153 8.55228475,18 8,18 C7.44771525,18 7,18.4477153 7,19 C7,19.5522847 7.44771525,20 8,20 Z M16,6 C16.5522847,6 17,5.55228475 17,5 C17,4.44771525 16.5522847,4 16,4 C15.4477153,4 15,4.44771525 15,5 C15,5.55228475 15.4477153,6 16,6 Z M8,6 C8.55228475,6 9,5.55228475 9,5 C9,4.44771525 8.55228475,4 8,4 C7.44771525,4 7,4.44771525 7,5 C7,5.55228475 7.44771525,6 8,6 Z" />
              </svg>
              {forkCount > 0 && (
                <span className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-neutral-500 px-1 text-[10px] font-bold text-white">
                  {forkCount}
                </span>
              )}
            </span>
          </button>
          <button
            onClick={() => setShowBeta(true)}
            className="relative flex items-center justify-center rounded-r-xl border-l border-neutral-600 px-5 py-3.5 text-neutral-400 transition-colors hover:bg-neutral-700"
            aria-label="Beta videos"
          >
            <span className="relative">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="h-5 w-5"
              >
                <path d="M7.8 2h8.4C19.4 2 22 4.6 22 7.8v8.4a5.8 5.8 0 0 1-5.8 5.8H7.8C4.6 22 2 19.4 2 16.2V7.8A5.8 5.8 0 0 1 7.8 2m-.2 2A3.6 3.6 0 0 0 4 7.6v8.8C4 18.39 5.61 20 7.6 20h8.8a3.6 3.6 0 0 0 3.6-3.6V7.6C20 5.61 18.39 4 16.4 4H7.6m9.65 1.5a1.25 1.25 0 0 1 1.25 1.25A1.25 1.25 0 0 1 17.25 8 1.25 1.25 0 0 1 16 6.75a1.25 1.25 0 0 1 1.25-1.25M12 7a5 5 0 0 1 5 5 5 5 0 0 1-5 5 5 5 0 0 1-5-5 5 5 0 0 1 5-5m0 2a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3z" />
              </svg>
              {betaLinks && betaLinks.length > 0 && (
                <span className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-neutral-500 px-1 text-[10px] font-bold text-white">
                  {betaLinks.length}
                </span>
              )}
            </span>
          </button>
        </div>
        <div className="flex-1" />
        <div className="flex rounded-xl">
          {isLoggedIn && (
            <LogMenu
              showMenu={showLogMenu}
              hasPriorSend={ascentInfo != null && ascentInfo.sendCount > 0}
              onToggle={() => setShowLogMenu((v) => !v)}
              onClose={() => setShowLogMenu(false)}
              onQuickSend={doQuickSend}
              onLogSend={() => { setShowLogMenu(false); setShowAscent(true); }}
              onLogAttempt={doLogAttempt}
            />
          )}
          {isLoggedIn && (
            <button
              onClick={() => setShowCircuits(true)}
              className="flex items-center justify-center border-r border-neutral-600 bg-neutral-700 px-4 py-4 text-neutral-400 transition-colors hover:bg-neutral-600 hover:text-neutral-200"
              aria-label="Update Circuits"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 748 384"
                fill="none"
                stroke="currentColor"
                strokeWidth="80"
                className="h-4 w-4"
              >
                <path d="M189.5 358.333L25 192.167L189.5 25H722.833V192.167V358.333H189.5Z" />
              </svg>
            </button>
          )}
          <button
            onClick={() => {
              if (circuits.length > 0 && !confirmBlock) {
                setConfirmBlock(true);
                setTimeout(() => setConfirmBlock(false), 3000);
                return;
              }
              doBlock();
            }}
            className={`flex items-center justify-center ${isLoggedIn ? "rounded-r-xl" : "rounded-xl"} px-4 py-4 transition-colors duration-150 ${disliking
              ? "bg-red-600/30 text-red-400"
              : confirmBlock
                ? "bg-yellow-600/20 text-yellow-400"
                : "bg-neutral-700 text-neutral-400 hover:bg-red-600/20 hover:text-red-400 active:bg-red-600/30"
              }`}
            aria-label={confirmBlock ? "Tap again to confirm block" : "Block climb"}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 32 32"
              fill="currentColor"
              className="h-4 w-4"
            >
              <path d="M16 29c-7.179 0-13-5.82-13-13s5.821-13 13-13c7.18 0 13 5.82 13 13s-5.82 13-13 13zM16 26c2.211 0 4.249-0.727 5.905-1.941l-13.963-13.962c-1.216 1.655-1.942 3.692-1.942 5.903 0 5.522 4.477 10 10 10zM16 6c-2.228 0-4.279 0.737-5.941 1.97l13.971 13.972c1.232-1.663 1.97-3.713 1.97-5.942 0-5.523-4.477-10-10-10z" />
            </svg>
          </button>
        </div>
      </div>

      {showAscent && (
        <AscentModal
          climb={climb}
          onClose={() => setShowAscent(false)}
          onLogged={() => {
            markLogged(climb.uuid);
            setShowAscent(false);
            setToast({ type: "success", message: "Sent!" });
          }}
        />
      )}

      {showCircuits && (
        <CircuitPicker
          climbUuid={climb.uuid}
          onClose={() => {
            setShowCircuits(false);
            refreshCircuits();
          }}
        />
      )}

      {showBeta && (
        <BetaSheet links={betaLinks} onClose={() => setShowBeta(false)} />
      )}

      {showForks && (
        <ForkModal
          climbUuid={climb.uuid}
          climbName={climb.name}
          frames={climb.frames}
          onClose={() => setShowForks(false)}
        />
      )}

      <AnimatePresence>
        {toast && (
          <Toast type={toast.type} message={toast.message} onDismiss={() => setToast(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}

function Toast({ type, message, onDismiss }: { type: "success" | "error"; message: string; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, type === "error" ? 4000 : 1500);
    return () => clearTimeout(timer);
  }, [onDismiss, type]);

  const isError = type === "error";

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="fixed bottom-20 left-0 right-0 z-[70] flex justify-center"
      onClick={onDismiss}
    >
      <div className={`rounded-lg px-4 py-2 ${isError ? "border border-red-600/30 bg-neutral-900" : "bg-neutral-800"}`}>
        <p className={`text-sm ${isError ? "text-red-400" : "text-neutral-300"}`}>{message}</p>
      </div>
    </motion.div>,
    document.body
  );
}

function LogMenu({
  showMenu,
  hasPriorSend,
  onToggle,
  onClose,
  onQuickSend,
  onLogSend,
  onLogAttempt,
}: {
  showMenu: boolean;
  hasPriorSend: boolean;
  onToggle: () => void;
  onClose: () => void;
  onQuickSend: () => void;
  onLogSend: () => void;
  onLogAttempt: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showMenu) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showMenu, onClose]);

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={onToggle}
        className="flex items-center gap-1 rounded-l-xl border-r border-neutral-600 bg-neutral-700 px-4 py-4 text-xs font-medium text-neutral-300 transition-colors hover:bg-neutral-600"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="currentColor"
          className="h-4 w-4"
        >
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M21.2287 6.60355C21.6193 6.99407 21.6193 7.62723 21.2287 8.01776L10.2559 18.9906C9.86788 19.3786 9.23962 19.3814 8.84811 18.9969L2.66257 12.9218C2.26855 12.5349 2.26284 11.9017 2.64983 11.5077L3.35054 10.7942C3.73753 10.4002 4.37067 10.3945 4.7647 10.7815L9.53613 15.4677L19.1074 5.89644C19.4979 5.50592 20.1311 5.50591 20.5216 5.89644L21.2287 6.60355Z"
          />
        </svg>
        Log
      </button>
      <AnimatePresence>
        {showMenu && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 8 }}
            transition={{ duration: 0.15 }}
            className="absolute bottom-full right-0 mb-2 w-44 origin-bottom-right divide-y divide-neutral-700 overflow-hidden rounded-xl border border-neutral-600 bg-neutral-800 shadow-lg"
          >
            {hasPriorSend && (
              <button
                onClick={onQuickSend}
                className="flex w-full items-center gap-2 px-4 py-3.5 text-left text-sm text-neutral-200 hover:bg-neutral-700"
              >
                Quick Log Send
              </button>
            )}
            <button
              onClick={onLogSend}
              className="flex w-full items-center gap-2 px-4 py-3.5 text-left text-sm text-neutral-200 hover:bg-neutral-700"
            >
              Log Send...
            </button>
            <button
              onClick={onLogAttempt}
              className="flex w-full items-center gap-2 px-4 py-3.5 text-left text-sm text-neutral-200 hover:bg-neutral-700"
            >
              Log Attempt
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function BetaSheet({ links, onClose }: { links: BetaLinkResult[] | null; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState(0); // -1 = left, 1 = right
  const count = links?.length ?? 0;
  const current = links?.[index];
  const [open, setOpen] = useState(false);

  useEffect(() => { setOpen(true); }, []);

  const animateClose = useCallback(() => {
    setOpen(false);
    setTimeout(onClose, 200);
  }, [onClose]);

  return createPortal(
    <motion.div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60"
      onClick={animateClose}
      animate={{ opacity: open ? 1 : 0 }}
      transition={{ duration: 0.15 }}
    >
      <motion.div
        className="w-full max-w-md rounded-t-2xl bg-neutral-800 p-4 pb-8"
        onClick={(e) => e.stopPropagation()}
        animate={{ y: open ? 0 : "100%" }}
        transition={{ type: "spring", stiffness: 400, damping: 35 }}
      >
        {links === null ? (
          <p className="text-sm text-neutral-400">Loading...</p>
        ) : links.length === 0 ? (
          <p className="text-sm text-neutral-400">No beta videos yet.</p>
        ) : current && (
          <>
            <div className="relative overflow-hidden rounded-lg" style={{ aspectRatio: "3 / 4" }}>
              <AnimatePresence initial={false} custom={direction}>
                <motion.div
                  key={index}
                  custom={direction}
                  variants={{
                    enter: (d: number) => ({ x: d > 0 ? "100%" : d < 0 ? "-100%" : 0 }),
                    center: { x: 0 },
                    exit: (d: number) => ({ x: d > 0 ? "-100%" : "100%" }),
                  }}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ type: "spring", stiffness: 300, damping: 30 }}
                  className="absolute inset-0"
                >
                  <iframe
                    src={toEmbedUrl(current.link)}
                    className="absolute border-0"
                    style={{
                      top: "-64px",
                      left: "-16px",
                      width: "calc(100% + 32px)",
                      height: "calc(100% + 200px)",
                    }}
                    allow="autoplay; encrypted-media"
                    allowFullScreen
                  />
                </motion.div>
              </AnimatePresence>
            </div>
            <div className="mt-3 flex items-center gap-3">
              {count > 1 && (
                <button
                  onClick={() => { setDirection(-1); setIndex((i) => (i - 1 + count) % count); }}
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-neutral-700 text-neutral-300 active:bg-neutral-600"
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-white">
                  {current.foreign_username ? `@${current.foreign_username}` : "Beta"}
                  {current.angle != null && ` · ${current.angle}°`}
                </p>
                <p className="text-xs text-neutral-400">
                  {index + 1} of {count} video{count !== 1 ? "s" : ""}
                </p>
              </div>
              {count > 1 && (
                <button
                  onClick={() => { setDirection(1); setIndex((i) => (i + 1) % count); }}
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-neutral-700 text-neutral-300 active:bg-neutral-600"
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              )}
              <a
                href={current.link}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-12 shrink-0 items-center rounded-xl bg-neutral-700 px-4 text-sm font-medium text-neutral-300 transition-colors active:bg-neutral-600"
              >
                Open
              </a>
            </div>
          </>
        )}
      </motion.div>
    </motion.div>,
    document.body
  );
}

/** Convert a video URL to an embeddable iframe src */
function toEmbedUrl(url: string): string {
  try {
    const u = new URL(url);
    // Instagram: /reel/ABC/ or /p/ABC/ → append /embed/?hidecaption=true
    if (u.hostname.includes("instagram.com")) {
      const path = u.pathname.replace(/\/$/, "");
      return `https://www.instagram.com${path}/embed/?hidecaption=true`;
    }
    // YouTube: watch?v=ABC → embed/ABC
    if (u.hostname.includes("youtube.com") && u.searchParams.has("v")) {
      return `https://www.youtube.com/embed/${u.searchParams.get("v")}`;
    }
    if (u.hostname.includes("youtu.be")) {
      return `https://www.youtube.com/embed${u.pathname}`;
    }
    return url;
  } catch {
    return url;
  }
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function daysAgoLabel(climbed_at: string): string {
  const then = new Date(climbed_at.replace(" ", "T"));
  const days = Math.floor((Date.now() - then.getTime()) / 86400000);
  if (days === 0) return "today";
  return `>${days}d ago`;
}

function StatBadge({
  label,
  variant = "default",
  strikethrough = false,
}: {
  label: string;
  variant?: "grade" | "benchmark" | "quality" | "default" | "sent" | "attempted" | "user-grade";
  strikethrough?: boolean;
}) {
  const colors = {
    grade: "bg-blue-600/20 text-blue-400",
    benchmark: "bg-purple-600/20 text-purple-400",
    quality: "bg-yellow-600/20 text-yellow-400",
    default: "bg-neutral-700 text-neutral-300",
    sent: "bg-green-600/20 text-green-400",
    attempted: "bg-neutral-700 text-neutral-300",
    "user-grade": "bg-orange-600/20 text-orange-400",
  };

  return (
    <span
      className={`rounded px-1.5 py-0.5 text-xs font-bold ${colors[variant]} ${strikethrough ? "line-through opacity-50" : ""}`}
    >
      {label}
    </span>
  );
}

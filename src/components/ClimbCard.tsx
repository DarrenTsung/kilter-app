"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import type { ClimbResult } from "@/lib/db/queries";
import { difficultyToGrade } from "@/store/filterStore";
import { useAuthStore } from "@/store/authStore";
import { useDeckStore } from "@/store/deckStore";
import { getDB } from "@/lib/db";
import { getCircuitMap, invalidateBlockCache, getBetaLinks, type CircuitInfo, type BetaLinkResult } from "@/lib/db/queries";
import { saveTag, fetchClimbBeta, checkLinksValid } from "@/lib/api/aurora";
import { BoardView } from "./BoardView";
import { LightUpButton } from "./LightUpButton";
import { AscentModal } from "./AscentModal";
import { CircuitPicker } from "./CircuitPicker";

interface UserAscentInfo {
  sendCount: number;
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
      const allForClimb = await db.getAllFromIndex("ascents", "by-climb", climbUuid);
      const mine = allForClimb
        .filter((a) => a.user_id === userId && a.angle === angle)
        .sort((a, b) => b.climbed_at.localeCompare(a.climbed_at));

      if (!cancelled) {
        setInfo({
          sendCount: mine.length,
          latestDifficulty: mine.length > 0 ? mine[0].difficulty : null,
          latestClimbedAt: mine.length > 0 ? mine[0].climbed_at : null,
        });
      }
    }
    load();
    return () => { cancelled = true; };
  }, [climbUuid, angle, userId, loggedUuids]);

  return info;
}

function useClimbCircuits(climbUuid: string): [CircuitInfo[], () => void] {
  const [circuits, setCircuits] = useState<CircuitInfo[]>([]);
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

        // Validate links are still publicly accessible
        const urls = merged.map((l) => l.link);
        checkLinksValid(urls).then((validSet) => {
          if (cancelled) return;
          setLinks((prev) => prev?.filter((l) => validSet.has(l.link)) ?? null);
        });
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
  const [disliking, setDisliking] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [recentlyLogged, setRecentlyLogged] = useState(false);
  const { isLoggedIn, token, userId } = useAuthStore();
  const markLogged = useDeckStore((s) => s.markLogged);
  const removeClimb = useDeckStore((s) => s.removeClimb);
  const ascentInfo = useUserAscents(climb.uuid, climb.angle);
  const [circuits, refreshCircuits] = useClimbCircuits(climb.uuid);
  const betaLinks = useBetaLinks(climb.uuid);

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

  return (
    <div className="flex flex-col justify-end gap-4 rounded-2xl border border-neutral-500/30 bg-gradient-to-b from-[#323232] via-[#222222] to-[#1c1c1c] px-3 py-4" style={{ aspectRatio: "9 / 16" }}>
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
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <StatBadge
            label={difficultyToGrade(climb.display_difficulty)}
            variant="grade"
          />
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
            by {climb.setter_username}
          </span>
        </div>
        {(ascentInfo || circuits.length > 0) && (
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {ascentInfo && (
              ascentInfo.sendCount === 0 ? (
                <StatBadge label="Not Sent" variant="default" />
              ) : (
                <>
                  {ascentInfo.latestDifficulty != null &&
                    ascentInfo.latestDifficulty !== climb.display_difficulty && (
                      <StatBadge
                        label={`${difficultyToGrade(ascentInfo.latestDifficulty)} (you)`}
                        variant="user-grade"
                      />
                    )}
                  <StatBadge
                    label={`${ascentInfo.sendCount} send${ascentInfo.sendCount > 1 ? "s" : ""} (you)`}
                    variant="sent"
                  />
                  {ascentInfo.latestClimbedAt && (
                    <StatBadge
                      label={daysAgoLabel(ascentInfo.latestClimbedAt)}
                      variant="default"
                    />
                  )}
                </>
              )
            )}
            {circuits.map((c) => (
              <span
                key={c.uuid}
                className="rounded-full px-2 py-0.5 text-xs font-medium text-white/90"
                style={{ backgroundColor: c.color || "#555" }}
              >
                {c.name}
              </span>
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
            className="flex items-center justify-center rounded-l-xl px-3.5 py-3 text-neutral-400 transition-colors hover:bg-neutral-700"
          />
          <button
            onClick={() => setShowBeta(true)}
            className="relative flex items-center justify-center rounded-r-xl border-l border-neutral-600 px-4.5 py-3 text-neutral-400 transition-colors hover:bg-neutral-700"
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
        <div className="flex overflow-hidden rounded-xl">
          {isLoggedIn && (
            <button
              onClick={() => setShowAscent(true)}
              className={`flex items-center gap-1 border-r border-neutral-600 px-3 py-3.5 text-xs font-medium transition-colors duration-500 ${recentlyLogged
                ? "bg-green-600/20 text-green-400"
                : "bg-neutral-700 text-neutral-300 hover:bg-neutral-600"
                }`}
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
              {recentlyLogged ? "Sent!" : "Log Send"}
            </button>
          )}
          {isLoggedIn && (
            <button
              onClick={() => setShowCircuits(true)}
              className="flex items-center justify-center border-r border-neutral-600 bg-neutral-700 px-3 py-3.5 text-neutral-400 transition-colors hover:bg-neutral-600 hover:text-neutral-200"
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
            className={`flex items-center justify-center px-3 py-3.5 transition-colors duration-150 ${disliking
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
            setRecentlyLogged(true);
            setTimeout(() => setRecentlyLogged(false), 1000);
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
    </div>
  );
}

function BetaSheet({ links, onClose }: { links: BetaLinkResult[] | null; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState(0); // -1 = left, 1 = right
  const count = links?.length ?? 0;
  const current = links?.[index];
  const [open, setOpen] = useState(false);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => { setOpen(true); }, []);

  const animateClose = useCallback(() => {
    setOpen(false);
    setTimeout(onClose, 200);
  }, [onClose]);

  function handleTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    touchStartRef.current = { x: t.clientX, y: t.clientY };
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (!touchStartRef.current || count <= 1) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStartRef.current.x;
    const dy = t.clientY - touchStartRef.current.y;
    touchStartRef.current = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx < 0) {
        setDirection(1);
        setIndex((i) => (i + 1) % count);
      } else {
        setDirection(-1);
        setIndex((i) => (i - 1 + count) % count);
      }
    }
  }

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
            <div className="relative overflow-hidden rounded-lg" style={{ aspectRatio: "9 / 16" }}>
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
                    className="h-full w-full border-0"
                    allow="autoplay; encrypted-media"
                    allowFullScreen
                  />
                </motion.div>
              </AnimatePresence>
              {/* Transparent swipe surface — sits on top of iframe to capture horizontal swipes */}
              {count > 1 && (
                <div
                  className="absolute inset-0 z-10"
                  onTouchStart={handleTouchStart}
                  onTouchEnd={handleTouchEnd}
                />
              )}
            </div>
            <div className="mt-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-white">
                  {current.foreign_username ? `@${current.foreign_username}` : "Beta"}
                  {current.angle != null && ` · ${current.angle}°`}
                </p>
                <p className="text-xs text-neutral-400">
                  {index + 1} of {count} video{count !== 1 ? "s" : ""}
                  {count > 1 && " · swipe to navigate"}
                </p>
              </div>
              <a
                href={current.link}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 rounded-lg bg-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-300 transition-colors active:bg-neutral-600"
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
    // Instagram: /reel/ABC/ or /p/ABC/ → append /embed/
    if (u.hostname.includes("instagram.com")) {
      const path = u.pathname.replace(/\/$/, "");
      return `https://www.instagram.com${path}/embed/`;
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
}: {
  label: string;
  variant?: "grade" | "benchmark" | "quality" | "default" | "sent" | "user-grade";
}) {
  const colors = {
    grade: "bg-blue-600/20 text-blue-400",
    benchmark: "bg-purple-600/20 text-purple-400",
    quality: "bg-yellow-600/20 text-yellow-400",
    default: "bg-neutral-700 text-neutral-300",
    sent: "bg-green-600/20 text-green-400",
    "user-grade": "bg-orange-600/20 text-orange-400",
  };

  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${colors[variant]}`}
    >
      {label}
    </span>
  );
}

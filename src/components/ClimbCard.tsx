"use client";

import { useState, useEffect } from "react";
import type { ClimbResult } from "@/lib/db/queries";
import { difficultyToGrade } from "@/store/filterStore";
import { useAuthStore } from "@/store/authStore";
import { useDeckStore } from "@/store/deckStore";
import { useDislikeStore } from "@/store/dislikeStore";
import { getDB } from "@/lib/db";
import { getCircuitMap, type CircuitInfo } from "@/lib/db/queries";
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

function useClimbCircuits(climbUuid: string): CircuitInfo[] {
  const [circuits, setCircuits] = useState<CircuitInfo[]>([]);

  useEffect(() => {
    let cancelled = false;
    getCircuitMap().then((map) => {
      if (!cancelled) setCircuits(map.get(climbUuid) ?? []);
    });
    return () => { cancelled = true; };
  }, [climbUuid]);

  return circuits;
}

export function ClimbCard({ climb }: { climb: ClimbResult }) {
  const [showAscent, setShowAscent] = useState(false);
  const [showCircuits, setShowCircuits] = useState(false);
  const [disliking, setDisliking] = useState(false);
  const [recentlyLogged, setRecentlyLogged] = useState(false);
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const markLogged = useDeckStore((s) => s.markLogged);
  const removeClimb = useDeckStore((s) => s.removeClimb);
  const dislike = useDislikeStore((s) => s.dislike);
  const ascentInfo = useUserAscents(climb.uuid, climb.angle);
  const circuits = useClimbCircuits(climb.uuid);

  return (
    <div className="flex h-full flex-col gap-1.5 rounded-2xl bg-neutral-800 px-1.5 py-[9px]">
      {/* Header */}
      <div className="px-2">
        <h2 className="text-lg font-bold leading-tight">{climb.name}</h2>
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
                    label={`Sent ×${ascentInfo.sendCount}`}
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
        className="min-h-0 flex-1 rounded-xl"
      />

      {/* Bottom action row */}
      <div className="flex items-center gap-3 px-1.5">
        <LightUpButton frames={climb.frames} />
        <div className="flex-1" />
        <div className="flex overflow-hidden rounded-xl">
          {isLoggedIn && (
            <button
              onClick={() => setShowAscent(true)}
              className={`flex items-center gap-1.5 border-r border-neutral-600 px-4 py-3 text-sm font-medium transition-colors duration-500 ${recentlyLogged
                  ? "bg-green-600/20 text-green-400"
                  : "bg-neutral-700 text-neutral-300 hover:bg-neutral-600"
                }`}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="h-5 w-5"
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
              className="flex items-center justify-center border-r border-neutral-600 bg-neutral-700 px-3 py-3 text-neutral-400 transition-colors hover:bg-neutral-600 hover:text-neutral-200"
              aria-label="Add to circuit"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4.5 w-4.5"
              >
                <line x1="8" y1="6" x2="21" y2="6" />
                <line x1="8" y1="12" x2="21" y2="12" />
                <line x1="8" y1="18" x2="21" y2="18" />
                <line x1="3" y1="6" x2="3.01" y2="6" />
                <line x1="3" y1="12" x2="3.01" y2="12" />
                <line x1="3" y1="18" x2="3.01" y2="18" />
              </svg>
            </button>
          )}
          <button
            onClick={() => {
              setDisliking(true);
              dislike(climb.uuid);
              setTimeout(() => removeClimb(climb.uuid), 150);
            }}
            className={`flex items-center justify-center px-4 py-3 transition-colors duration-150 ${disliking
                ? "bg-red-600/30 text-red-400"
                : "bg-neutral-700 text-neutral-400 hover:bg-red-600/20 hover:text-red-400 active:bg-red-600/30"
              }`}
            aria-label="Dislike climb"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 64 64"
              fill="currentColor"
              className="h-3.5 w-3.5"
            >
              <path d="M60,40H32v20c0,2.207-1.789,4-4,4h-8c-2.211,0-4-1.793-4-4V40V0h35.188C53.75,0,55.309,1.75,56,4l7.844,31.363C64.5,38.246,62.211,40,60,40z" />
              <path d="M0,36V4c0-2.215,1.789-4,4-4h4v40H4C1.789,40,0,38.207,0,36z" />
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
          onClose={() => setShowCircuits(false)}
        />
      )}
    </div>
  );
}

function daysAgoLabel(climbed_at: string): string {
  const then = new Date(climbed_at.replace(" ", "T"));
  const days = Math.floor((Date.now() - then.getTime()) / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days}d ago`;
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

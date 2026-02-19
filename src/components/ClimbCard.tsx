"use client";

import { useState } from "react";
import type { ClimbResult } from "@/lib/db/queries";
import { difficultyToGrade } from "@/store/filterStore";
import { useAuthStore } from "@/store/authStore";
import { useDeckStore } from "@/store/deckStore";
import { useDislikeStore } from "@/store/dislikeStore";
import { BoardView } from "./BoardView";
import { LightUpButton } from "./LightUpButton";
import { AscentModal } from "./AscentModal";

export function ClimbCard({ climb }: { climb: ClimbResult }) {
  const [showAscent, setShowAscent] = useState(false);
  const [disliking, setDisliking] = useState(false);
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const logged = useDeckStore((s) => s.loggedUuids.has(climb.uuid));
  const markLogged = useDeckStore((s) => s.markLogged);
  const removeClimb = useDeckStore((s) => s.removeClimb);
  const dislike = useDislikeStore((s) => s.dislike);

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
              className={`flex items-center gap-1.5 border-r border-neutral-600 px-4 py-3 text-sm font-medium transition-colors ${
                logged
                  ? "bg-green-600/20 text-green-400"
                  : "bg-neutral-700 text-neutral-300 hover:bg-neutral-600"
              }`}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="h-4 w-4"
              >
                {logged ? (
                  <path
                    fillRule="evenodd"
                    d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
                    clipRule="evenodd"
                  />
                ) : (
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
                    clipRule="evenodd"
                  />
                )}
              </svg>
              {logged ? "Sent!" : "Log Send"}
            </button>
          )}
          <button
            onClick={() => {
              setDisliking(true);
              dislike(climb.uuid);
              setTimeout(() => removeClimb(climb.uuid), 150);
            }}
            className={`flex items-center justify-center px-4 py-3 transition-colors duration-150 ${
              disliking
                ? "bg-red-600/30 text-red-400"
                : "bg-neutral-700 text-neutral-400 hover:bg-red-600/20 hover:text-red-400 active:bg-red-600/30"
            }`}
            aria-label="Dislike climb"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 64 64"
              fill="currentColor"
              className="h-4 w-4"
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
          }}
        />
      )}
    </div>
  );
}

function StatBadge({
  label,
  variant = "default",
}: {
  label: string;
  variant?: "grade" | "benchmark" | "quality" | "default";
}) {
  const colors = {
    grade: "bg-blue-600/20 text-blue-400",
    benchmark: "bg-purple-600/20 text-purple-400",
    quality: "bg-yellow-600/20 text-yellow-400",
    default: "bg-neutral-700 text-neutral-300",
  };

  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${colors[variant]}`}
    >
      {label}
    </span>
  );
}

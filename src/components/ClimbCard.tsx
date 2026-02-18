"use client";

import type { ClimbResult } from "@/lib/db/queries";
import { difficultyToGrade } from "@/store/filterStore";
import { BoardView } from "./BoardView";
import { LightUpButton } from "./LightUpButton";

export function ClimbCard({ climb }: { climb: ClimbResult }) {
  return (
    <div className="flex h-full flex-col rounded-2xl bg-neutral-800 p-1.5">
      {/* Header */}
      <div className="px-2.5 pt-2">
        <h2 className="text-lg font-bold leading-tight">{climb.name}</h2>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
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

      {/* Spacer to center board in remaining space */}
      <div className="flex-1" />

      {/* Board visualization */}
      <BoardView
        frames={climb.frames}
        className="rounded-xl py-3"
      />

      {/* Bottom spacer */}
      <div className="flex-1" />

      {/* Bottom action row */}
      <div className="flex items-center gap-2 px-2 pb-2">
        <LightUpButton frames={climb.frames} />
      </div>
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

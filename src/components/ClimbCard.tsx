"use client";

import type { ClimbResult } from "@/lib/db/queries";
import { difficultyToGrade } from "@/store/filterStore";

export function ClimbCard({ climb }: { climb: ClimbResult }) {
  return (
    <div className="flex h-full flex-col rounded-2xl bg-neutral-800 p-5">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold leading-tight">{climb.name}</h2>
        <p className="mt-1 text-sm text-neutral-400">
          by {climb.setter_username}
        </p>
      </div>

      {/* Stats */}
      <div className="mt-4 flex flex-wrap gap-2">
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
      </div>

      {/* Board visualization area — placeholder for Phase 3 board image */}
      <div className="mt-4 flex flex-1 items-center justify-center rounded-xl bg-neutral-900/50">
        <p className="text-sm text-neutral-600">Board view</p>
      </div>

      {/* Climb history */}
      {climb.last_climbed_at && (
        <p className="mt-3 text-xs text-neutral-500">
          Last sent: {new Date(climb.last_climbed_at).toLocaleDateString()}
        </p>
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
      className={`rounded-full px-3 py-1 text-sm font-medium ${colors[variant]}`}
    >
      {label}
    </span>
  );
}

"use client";

import type { ReactNode } from "react";
import { difficultyToGrade } from "@/store/filterStore";
import {
  ROLE_COLORS,
  ROLE_LABELS,
  ROLE_ORDER,
  type HoldStatsSummary,
} from "@/lib/holdStats";

interface HoldStatsPanelProps {
  angle: number;
  loading: boolean;
  summary: HoldStatsSummary | null;
  /** Magnified view of the hold, shown on the left. */
  magnifier: ReactNode;
}

/** Warm (hard) → cool (easy) colour ramp, matching grade difficulty. */
function gradeColor(grade: number, minGrade: number, maxGrade: number): string {
  const t = maxGrade > minGrade ? (grade - minGrade) / (maxGrade - minGrade) : 0;
  const hue = 145 - 145 * t; // 145 = green, 0 = red
  return `hsl(${hue} 72% 55%)`;
}

function Histogram({ summary }: { summary: HoldStatsSummary }) {
  const { histogram, peak, median, minGrade, maxGrade, low, high } = summary;
  const count = histogram.length;
  const medianPct = count > 1 ? ((median - minGrade + 0.5) / count) * 100 : 50;

  return (
    <div className="relative mt-1.5">
      <div className="flex h-9 items-end gap-px">
        {histogram.map((value, i) => {
          const grade = minGrade + i;
          const height = value > 0 && peak > 0 ? Math.max(2, Math.round((value / peak) * 36)) : 0;
          return (
            <div
              key={grade}
              className="flex-1 rounded-[1px]"
              style={{
                height,
                background: gradeColor(grade, minGrade, maxGrade),
                opacity: grade >= low && grade <= high ? 1 : 0,
              }}
            />
          );
        })}
      </div>
      {/* Median marker */}
      <div
        className="pointer-events-none absolute -top-1 bottom-0 w-px bg-white/70"
        style={{ left: `${medianPct}%` }}
      />
      <div className="mt-0.5 flex justify-between text-[9px] leading-tight text-neutral-500">
        <span>{difficultyToGrade(low)}</span>
        <span>{difficultyToGrade(high)}</span>
      </div>
    </div>
  );
}

export function HoldStatsPanel({ angle, loading, summary, magnifier }: HoldStatsPanelProps) {
  const hasData = !!summary && summary.uses > 0;

  return (
    <div className="pointer-events-none w-[248px] rounded-xl border border-neutral-700 bg-neutral-900/95 p-2.5 shadow-2xl shadow-black/70 backdrop-blur-sm">
      <div className="flex gap-2.5">
        <div className="h-[72px] w-[72px] shrink-0 overflow-hidden rounded-lg border border-neutral-700 bg-neutral-950">
          {magnifier}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[11px] font-semibold text-neutral-300">Hold popularity</span>
            <span className="text-[10px] text-neutral-500">{angle}°</span>
          </div>

          {loading ? (
            <p className="mt-2 text-[11px] text-neutral-500">Analyzing holds…</p>
          ) : !hasData ? (
            <p className="mt-2 text-[11px] text-neutral-500">
              No climbs in the library use this hold.
            </p>
          ) : (
            <>
              <div className="mt-1 flex items-baseline gap-1">
                <span className="text-xl font-bold leading-none text-white">
                  {summary.pct < 1 ? summary.pct.toFixed(1) : summary.pct.toFixed(0)}
                </span>
                <span className="text-[10px] text-neutral-400">% of climbs</span>
              </div>

              <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-neutral-800">
                <div
                  className="h-full rounded-full bg-blue-500"
                  style={{ width: `${Math.max(2, summary.percentile)}%` }}
                />
              </div>
              <p className="mt-1 text-[10px] leading-tight text-neutral-500">
                more popular than {Math.min(99, Math.floor(summary.percentile))}% of holds
              </p>
            </>
          )}
        </div>
      </div>

      {hasData && summary && (
        <div className="mt-2 border-t border-neutral-800 pt-2">
          <div className="flex items-center justify-between text-[10px] text-neutral-400">
            <span>
              Typical{" "}
              <span className="font-semibold text-neutral-200">
                {difficultyToGrade(summary.p25)}–{difficultyToGrade(summary.p75)}
              </span>
            </span>
            <span>
              Avg <span className="font-semibold text-neutral-200">{difficultyToGrade(summary.mean)}</span>
            </span>
            <span>
              Median{" "}
              <span className="font-semibold text-neutral-200">{difficultyToGrade(summary.median)}</span>
            </span>
          </div>
          <Histogram summary={summary} />

          {/* How the hold is typically used */}
          <div className="mt-1.5 flex items-center gap-2">
            <span className="shrink-0 text-[10px] text-neutral-400">Used as</span>
            <div className="flex h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-neutral-800">
              {ROLE_ORDER.map((role, i) => (
                <div
                  key={role}
                  style={{ width: `${summary.rolePct[i]}%`, background: ROLE_COLORS[role] }}
                />
              ))}
            </div>
            <span
              className="shrink-0 text-[10px] font-semibold"
              style={{ color: summary.dominantRole ? ROLE_COLORS[summary.dominantRole] : undefined }}
            >
              {summary.dominantRole ? ROLE_LABELS[summary.dominantRole] : "?"}{" "}
              {Math.round(summary.dominantPct)}%
            </span>
          </div>

          <p className="mt-0.5 text-[9px] text-neutral-500">
            {summary.uses.toLocaleString()} of {summary.climbs.toLocaleString()} climbs at {angle}°
          </p>
        </div>
      )}
    </div>
  );
}

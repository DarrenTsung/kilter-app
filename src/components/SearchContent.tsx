"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useAuthStore } from "@/store/authStore";
import { useFilterStore, difficultyToGrade } from "@/store/filterStore";
import { useDeckStore } from "@/store/deckStore";
import { useTabStore } from "@/store/tabStore";
import { searchClimbs, getCircuitMap, getUserClimbGrades, getBetaClimbUuids, type ClimbResult, type CircuitInfo } from "@/lib/db/queries";

// Module-level caches
let cachedSentUuids: Set<string> = new Set();
let cachedUserGrades: Map<string, number> = new Map();
let cachedBetaUuids: Set<string> = new Set();
let cachedCircuitMap: Map<string, CircuitInfo[]> = new Map();
let cachedForKey: string | null = null;

export function SearchContent() {
  const { userId } = useAuthStore();
  const angle = useFilterStore((s) => s.angle);
  const setDeck = useDeckStore((s) => s.setDeck);
  const setTab = useTabStore((s) => s.setTab);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ClimbResult[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [sentUuids, setSentUuids] = useState(cachedSentUuids);
  const [userGrades, setUserGrades] = useState(cachedUserGrades);
  const [betaUuids, setBetaUuids] = useState(cachedBetaUuids);
  const [circuitMap, setCircuitMap] = useState(cachedCircuitMap);

  const cacheKey = `${userId}-${angle}`;

  // Load metadata caches
  useEffect(() => {
    if (cachedForKey === cacheKey && cachedSentUuids.size > 0) return;

    getUserClimbGrades(userId, angle).then(({ sentUuids: s, userGrades: g }) => {
      cachedSentUuids = s; cachedUserGrades = g;
      setSentUuids(s); setUserGrades(g);
    });
    getBetaClimbUuids().then((b) => { cachedBetaUuids = b; setBetaUuids(b); });
    getCircuitMap().then((m) => { cachedCircuitMap = m; setCircuitMap(m); });
    cachedForKey = cacheKey;
  }, [userId, angle, cacheKey]);

  // Debounced search
  const doSearch = useCallback(async (q: string) => {
    if (q.length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    const r = await searchClimbs(q, angle);
    setResults(r);
    setSearching(false);
  }, [angle]);

  function handleInput(value: string) {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(value), 200);
  }

  async function handleClimbTap(climb: ClimbResult) {
    setDeck([climb]);
    window.history.pushState({ from: "search" }, "", "/randomizer");
    setTab("randomizer");
  }

  return (
    <div className="flex h-full flex-col">
      {/* Search bar */}
      <div className="shrink-0 border-b border-neutral-800 bg-neutral-900 px-4 py-3">
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#737373" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            value={query}
            onChange={(e) => handleInput(e.target.value)}
            placeholder="Search climbs..."
            className="w-full rounded-lg bg-neutral-800 py-2.5 pl-10 pr-10 text-sm text-white placeholder-neutral-500 outline-none focus:ring-1 focus:ring-blue-500"
          />
          {query && (
            <button
              onClick={() => { setQuery(""); setResults([]); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500 active:text-neutral-300"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {query.length < 2 ? (
          <p className="px-4 py-8 text-center text-sm text-neutral-500">
            Type to search climbs
          </p>
        ) : searching && results.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-neutral-500">
            Searching...
          </p>
        ) : results.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-neutral-500">
            No climbs match &ldquo;{query}&rdquo;
          </p>
        ) : (
          results.map((climb) => {
            const circuits = circuitMap.get(climb.uuid);
            const isSent = sentUuids.has(climb.uuid);
            const hasBeta = betaUuids.has(climb.uuid);
            const userGrade = userGrades.get(climb.uuid);
            const hasCustomGrade = userGrade != null && difficultyToGrade(userGrade) !== difficultyToGrade(climb.display_difficulty);

            return (
              <button
                key={climb.uuid}
                onClick={() => handleClimbTap(climb)}
                className="flex w-full items-start gap-2 border-b border-neutral-800/50 px-4 py-3 text-left active:bg-neutral-800/50"
              >
                {/* Left icon area */}
                <div className="relative w-3 shrink-0" style={{ minHeight: "28px" }}>
                  {isSent && (
                    <svg className="absolute left-0 top-[5px]" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#a3a3a3" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                  {hasBeta && (
                    <svg className="absolute left-[1px] top-[25.35px]" width="10" height="10" viewBox="0 0 24 24" fill="#a3a3a3">
                      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
                    </svg>
                  )}
                </div>

                {/* Middle: name, setter, circuits */}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-medium text-white">
                    {climb.name}
                  </p>
                  <p className="truncate text-[11px] text-neutral-400">
                    {climb.setter_username}
                  </p>
                  {circuits && circuits.length > 0 && (
                    <div className="-ml-1 mt-1 flex flex-wrap gap-1">
                      {circuits.map((c) => (
                        <span
                          key={c.uuid}
                          className="rounded-full px-1.5 py-0.5 text-[12px] font-medium normal-case tracking-normal leading-tight text-white/80"
                          style={{ backgroundColor: c.color }}
                        >
                          {c.name.toLowerCase()}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Right: grade, ascents, rating */}
                <div className="shrink-0 text-right">
                  <div className="flex items-center justify-end gap-1">
                    {hasCustomGrade && (
                      <span className="rounded bg-blue-600/20 px-1.5 py-0.5 text-xs font-bold text-blue-400 line-through opacity-50">
                        {difficultyToGrade(climb.display_difficulty)}
                      </span>
                    )}
                    <span className={`rounded px-1.5 py-0.5 text-xs font-bold ${hasCustomGrade ? "bg-orange-600/20 text-orange-400" : "bg-blue-600/20 text-blue-400"}`}>
                      {difficultyToGrade(hasCustomGrade ? userGrade : climb.display_difficulty)}
                    </span>
                  </div>
                  <p className="mt-1 text-[10px] text-neutral-400">
                    {climb.ascensionist_count.toLocaleString()} · {"★".repeat(Math.round(climb.quality_average))} {climb.quality_average.toFixed(1)}
                  </p>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

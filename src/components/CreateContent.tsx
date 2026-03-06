"use client";

import { useState, useCallback, useMemo } from "react";
import {
  InteractiveBoardView,
  type SelectedHold,
} from "./InteractiveBoardView";
import { useAuthStore } from "@/store/authStore";
import { useFilterStore } from "@/store/filterStore";
import { generateUUID } from "@/lib/api/aurora";

const LAYOUT_ID = 8;
const EDGE_LEFT = -44;
const EDGE_RIGHT = 44;
const EDGE_BOTTOM = 24;
const EDGE_TOP = 144;

export function CreateContent() {
  const { token, userId, username, isLoggedIn } = useAuthStore();
  const angle = useFilterStore((s) => s.angle);
  const [selectedHolds, setSelectedHolds] = useState<SelectedHold[]>([]);
  const [showPanel, setShowPanel] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [allowMatching, setAllowMatching] = useState(false);
  const [isDraft, setIsDraft] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [startRoleId, setStartRoleId] = useState<number | null>(null);
  const [finishRoleId, setFinishRoleId] = useState<number | null>(null);

  const handleHoldsChange = useCallback((holds: SelectedHold[]) => {
    setSelectedHolds(holds);
    setSuccess(false);
    setError(null);
  }, []);

  const handleRolesLoaded = useCallback(
    (roles: Map<string, { id: number }>) => {
      setStartRoleId(roles.get("start")?.id ?? null);
      setFinishRoleId(roles.get("finish")?.id ?? null);
    },
    []
  );

  const hasStart = useMemo(
    () => startRoleId !== null && selectedHolds.some((h) => h.roleId === startRoleId),
    [selectedHolds, startRoleId]
  );
  const hasFinish = useMemo(
    () => finishRoleId !== null && selectedHolds.some((h) => h.roleId === finishRoleId),
    [selectedHolds, finishRoleId]
  );
  const canProceed = hasStart && hasFinish;

  const buildFrames = useCallback(() => {
    return selectedHolds
      .map((h) => `p${h.placementId}r${h.roleId}`)
      .join("");
  }, [selectedHolds]);

  const handleSave = useCallback(async () => {
    if (!token || !userId || !username) {
      setError("Not logged in");
      return;
    }
    if (!name.trim()) {
      setError("Name is required");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const uuid = generateUUID();
      const frames = buildFrames();

      const formBody = new URLSearchParams({
        uuid,
        layout_id: String(LAYOUT_ID),
        setter_id: String(userId),
        name: name.trim(),
        description: description.trim(),
        is_nomatch: allowMatching ? "0" : "1",
        is_draft: isDraft ? "1" : "0",
        frames_count: "1",
        frames_pace: "0",
        frames,
        angle: String(angle),
      }).toString();

      const response = await fetch("/api/aurora/climbs/save", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Aurora-Token": token,
          "X-HTTP-Method-Override": "PUT",
        },
        body: formBody,
      });

      if (!response.ok) {
        const body = await response.text();
        console.error("[createClimb] failed:", response.status, body);
        throw new Error(`Save failed (${response.status}): ${body}`);
      }

      setSuccess(true);
      setSelectedHolds([]);
      setName("");
      setDescription("");
      setShowPanel(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [token, userId, username, name, description, allowMatching, isDraft, selectedHolds, buildFrames]);

  const handleClear = useCallback(() => {
    setSelectedHolds([]);
    setError(null);
    setSuccess(false);
  }, []);

  if (!isLoggedIn) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <p className="text-neutral-500">Log in via Settings to create climbs.</p>
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col">
      {/* Board fills the screen */}
      <div className="flex-1 min-h-0">
        <InteractiveBoardView
          selectedHolds={selectedHolds}
          onHoldsChange={handleHoldsChange}
          onRolesLoaded={handleRolesLoaded}
          className="h-full"
        />
      </div>

      {/* Bottom toolbar */}
      <div className="shrink-0 flex items-center justify-between border-t border-neutral-800 bg-neutral-900 px-4 py-2">
        <div className="flex items-center gap-3">
          <span className="text-sm text-neutral-400">
            {selectedHolds.length} hold{selectedHolds.length !== 1 ? "s" : ""}
          </span>
          {selectedHolds.length > 0 && (
            <button
              onClick={handleClear}
              className="text-sm text-red-400 active:text-red-300"
            >
              Clear
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          {!hasStart && (
            <span className="text-xs text-neutral-500">Need start</span>
          )}
          {!hasFinish && (
            <span className="text-xs text-neutral-500">
              {!hasStart ? "+ finish" : "Need finish"}
            </span>
          )}
          <button
            onClick={() => setShowPanel(true)}
            disabled={!canProceed}
            className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white transition-colors active:bg-blue-500 disabled:bg-neutral-700 disabled:text-neutral-500"
          >
            Next
          </button>
        </div>
      </div>

      {/* Success toast */}
      {success && (
        <div className="absolute left-4 right-4 bottom-16 rounded-lg bg-green-900/80 px-4 py-2 text-center text-sm text-green-300">
          Climb saved!
        </div>
      )}

      {/* Metadata panel (bottom sheet) */}
      {showPanel && (
        <>
          {/* Backdrop */}
          <div
            className="absolute inset-0 z-[60] bg-black/50"
            onClick={() => setShowPanel(false)}
          />

          {/* Panel */}
          <div className="absolute inset-x-0 bottom-0 z-[60] rounded-t-2xl border-t border-neutral-700 bg-neutral-900 px-4 pt-4 pb-8">
            {/* Drag handle */}
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-neutral-600" />

            <div className="space-y-3">
              {/* Name */}
              <div>
                <label className="mb-1 block text-xs font-medium text-neutral-400">
                  Name *
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Climb name"
                  autoFocus
                  className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-200 placeholder-neutral-500 focus:border-neutral-500 focus:outline-none"
                />
              </div>

              {/* Description */}
              <div>
                <label className="mb-1 block text-xs font-medium text-neutral-400">
                  Description (optional)
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Optional description"
                  rows={2}
                  className="w-full resize-none rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-200 placeholder-neutral-500 focus:border-neutral-500 focus:outline-none"
                />
              </div>

              {/* Toggles */}
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-neutral-400">Allow matching</span>
                  <SegmentedToggle value={allowMatching} onChange={setAllowMatching} />
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-neutral-400">Save as draft</span>
                  <SegmentedToggle value={isDraft} onChange={setIsDraft} />
                </div>
              </div>

              {/* Disclaimer */}
              <p className="text-xs text-neutral-500">
                You can edit your Draft boulders before publishing them to the
                community. Once published, a boulder can no longer be edited.
              </p>

              {/* Error */}
              {error && <p className="text-sm text-red-400">{error}</p>}

              {/* Save */}
              <button
                onClick={handleSave}
                disabled={saving || !name.trim()}
                className="w-full rounded-lg bg-blue-600 py-3 text-sm font-semibold text-white transition-colors active:bg-blue-500 disabled:bg-neutral-700 disabled:text-neutral-500"
              >
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function SegmentedToggle({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="relative flex overflow-hidden rounded-lg bg-neutral-800">
      {/* Sliding highlight */}
      <div
        className="absolute top-0 bottom-0 w-1/2 rounded-lg bg-blue-600 transition-transform duration-200"
        style={{ transform: value ? "translateX(100%)" : "translateX(0)" }}
      />
      <button
        type="button"
        onClick={() => onChange(false)}
        className={`relative z-10 px-3 py-1.5 text-sm font-medium transition-colors ${!value ? "text-white" : "text-neutral-500"}`}
      >
        No
      </button>
      <button
        type="button"
        onClick={() => onChange(true)}
        className={`relative z-10 px-3 py-1.5 text-sm font-medium transition-colors ${value ? "text-white" : "text-neutral-500"}`}
      >
        Yes
      </button>
    </div>
  );
}

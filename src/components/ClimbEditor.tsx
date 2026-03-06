"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import {
  InteractiveBoardView,
  type SelectedHold,
} from "./InteractiveBoardView";
import { useAuthStore } from "@/store/authStore";
import { useFilterStore } from "@/store/filterStore";
import { generateUUID, saveClimb } from "@/lib/api/aurora";
import { getDB } from "@/lib/db";
import { parseFrames } from "@/lib/utils/frames";

const LAYOUT_ID = 8;

interface ClimbEditorProps {
  initialClimbUuid?: string;
  onBack: () => void;
}

export function ClimbEditor({ initialClimbUuid, onBack }: ClimbEditorProps) {
  const { token, userId, username } = useAuthStore();
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
  const [editUuid, setEditUuid] = useState<string | null>(
    initialClimbUuid ?? null
  );
  const [loading, setLoading] = useState(!!initialClimbUuid);

  // Load existing climb data for edit mode
  useEffect(() => {
    if (!initialClimbUuid) return;
    async function loadClimb() {
      try {
        const db = await getDB();
        const climb = await db.get("climbs", initialClimbUuid!);
        if (climb) {
          setName(climb.name);
          setDescription(climb.description);
          setIsDraft(climb.is_draft === 1);
          setSelectedHolds(parseFrames(climb.frames));
        }
      } finally {
        setLoading(false);
      }
    }
    loadClimb();
  }, [initialClimbUuid]);

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
    () =>
      startRoleId !== null &&
      selectedHolds.some((h) => h.roleId === startRoleId),
    [selectedHolds, startRoleId]
  );
  const hasFinish = useMemo(
    () =>
      finishRoleId !== null &&
      selectedHolds.some((h) => h.roleId === finishRoleId),
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
      const uuid = editUuid ?? generateUUID();
      const frames = buildFrames();

      await saveClimb(token, {
        uuid,
        layoutId: LAYOUT_ID,
        setterId: userId,
        name: name.trim(),
        description: description.trim(),
        frames,
        angle,
        isDraft,
        isNoMatch: !allowMatching,
      });

      // Save locally to IndexedDB so drafts list updates
      const db = await getDB();
      await db.put("climbs", {
        uuid,
        layout_id: LAYOUT_ID,
        setter_id: userId,
        setter_username: username,
        name: name.trim(),
        description: description.trim(),
        frames,
        frames_count: 1,
        is_draft: isDraft ? 1 : 0,
        is_listed: 1,
        edge_left: 0,
        edge_right: 0,
        edge_bottom: 0,
        edge_top: 0,
        angle,
      });

      setSuccess(true);
      setShowPanel(false);
      if (!editUuid) {
        setEditUuid(uuid);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [
    token,
    userId,
    username,
    name,
    description,
    allowMatching,
    isDraft,
    editUuid,
    buildFrames,
    angle,
  ]);

  const handleClear = useCallback(() => {
    setSelectedHolds([]);
    setError(null);
    setSuccess(false);
  }, []);

  const isEditMode = editUuid !== null;

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-neutral-900">
        <p className="text-sm text-neutral-600">Loading climb...</p>
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col">
      {/* Header */}
      <div className="shrink-0 flex items-center gap-3 border-b border-neutral-800 bg-neutral-900 px-3 py-2">
        <button
          onClick={onBack}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-400 active:bg-neutral-800"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-300">
          {isEditMode ? "Edit Draft" : "Create Climb"}
        </h2>
      </div>

      {/* Board */}
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
            {isEditMode ? "Save" : "Next"}
          </button>
        </div>
      </div>

      {/* Success toast */}
      {success && (
        <div className="absolute left-4 right-4 bottom-16 rounded-lg bg-green-900/80 px-4 py-2 text-center text-sm text-green-300">
          {isEditMode && !initialClimbUuid ? "Climb created!" : "Saved!"}
        </div>
      )}

      {/* Metadata panel (bottom sheet) */}
      {showPanel && (
        <>
          <div
            className="absolute inset-0 z-[60] bg-black/50"
            onClick={() => setShowPanel(false)}
          />
          <div className="absolute inset-x-0 bottom-0 z-[60] rounded-t-2xl border-t border-neutral-700 bg-neutral-900 px-4 pt-4 pb-8">
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-neutral-600" />
            <div className="space-y-3">
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
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-neutral-400">
                    Allow matching
                  </span>
                  <SegmentedToggle
                    value={allowMatching}
                    onChange={setAllowMatching}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-neutral-400">
                    Save as draft
                  </span>
                  <SegmentedToggle value={isDraft} onChange={setIsDraft} />
                </div>
              </div>
              <p className="text-xs text-neutral-500">
                You can edit your Draft boulders before publishing them to the
                community. Once published, a boulder can no longer be edited.
              </p>
              {error && <p className="text-sm text-red-400">{error}</p>}
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

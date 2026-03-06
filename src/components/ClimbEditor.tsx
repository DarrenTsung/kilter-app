"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import {
  InteractiveBoardView,
  type SelectedHold,
} from "./InteractiveBoardView";
import { useAuthStore } from "@/store/authStore";
import { useFilterStore } from "@/store/filterStore";
import { useBleStore } from "@/store/bleStore";
import { generateUUID, saveClimb, deleteClimb } from "@/lib/api/aurora";
import { getDB } from "@/lib/db";
import { parseFrames } from "@/lib/utils/frames";
import { requestConnection, disconnect } from "@/lib/ble/connection";
import { lightUpClimb } from "@/lib/ble/commands";

const LAYOUT_ID = 8;

interface ClimbEditorProps {
  initialClimbUuid?: string;
  onBack: () => void;
}

export function ClimbEditor({ initialClimbUuid, onBack }: ClimbEditorProps) {
  const { token, userId, username } = useAuthStore();
  const angle = useFilterStore((s) => s.angle);
  const bleStatus = useBleStore((s) => s.status);
  const bleIsSending = useBleStore((s) => s.isSending);
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
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Track last-saved state for diff display
  const [savedHolds, setSavedHolds] = useState<SelectedHold[]>([]);
  const [savedName, setSavedName] = useState("");
  const [savedDescription, setSavedDescription] = useState("");
  const [savedAllowMatching, setSavedAllowMatching] = useState(false);

  // Undo/redo stacks
  const [undoStack, setUndoStack] = useState<SelectedHold[][]>([]);
  const [redoStack, setRedoStack] = useState<SelectedHold[][]>([]);
  const holdsRef = useRef(selectedHolds);
  holdsRef.current = selectedHolds;

  // Track user interaction for auto BLE send (skip initial load)
  const userEditedRef = useRef(false);

  // BLE disconnect confirm (double-tap pattern)
  const [confirmingBleDisconnect, setConfirmingBleDisconnect] = useState(false);
  const bleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (bleStatus !== "connected") setConfirmingBleDisconnect(false);
  }, [bleStatus]);
  useEffect(
    () => () => {
      if (bleTimerRef.current) clearTimeout(bleTimerRef.current);
    },
    []
  );

  // Auto light-up board when holds change (user interaction only)
  useEffect(() => {
    if (!userEditedRef.current) return;
    if (selectedHolds.length === 0) return;
    if (useBleStore.getState().status !== "connected") return;

    const frames = selectedHolds
      .map((h) => `p${h.placementId}r${h.roleId}`)
      .join("");
    lightUpClimb(frames);
  }, [selectedHolds]);

  // Load existing climb data for edit mode
  useEffect(() => {
    if (!initialClimbUuid) return;
    async function loadClimb() {
      try {
        const db = await getDB();
        const climb = await db.get("climbs", initialClimbUuid!);
        if (climb) {
          const holds = parseFrames(climb.frames);
          setName(climb.name);
          setDescription(climb.description);
          setIsDraft(climb.is_draft === 1);
          setSelectedHolds(holds);
          setSavedHolds(holds);
          setSavedName(climb.name);
          setSavedDescription(climb.description);
        }
      } finally {
        setLoading(false);
      }
    }
    loadClimb();
  }, [initialClimbUuid]);

  const handleHoldsChange = useCallback((holds: SelectedHold[]) => {
    userEditedRef.current = true;
    setUndoStack((prev) => [...prev, holdsRef.current]);
    setRedoStack([]);
    setSelectedHolds(holds);
    setSuccess(false);
    setError(null);
  }, []);

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    userEditedRef.current = true;
    const prev = undoStack[undoStack.length - 1];
    setUndoStack((s) => s.slice(0, -1));
    setRedoStack((s) => [...s, holdsRef.current]);
    setSelectedHolds(prev);
  }, [undoStack]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) return;
    userEditedRef.current = true;
    const next = redoStack[redoStack.length - 1];
    setRedoStack((s) => s.slice(0, -1));
    setUndoStack((s) => [...s, holdsRef.current]);
    setSelectedHolds(next);
  }, [redoStack]);

  const handleRolesLoaded = useCallback(
    (roles: Map<string, { id: number }>) => {
      setStartRoleId(roles.get("start")?.id ?? null);
      setFinishRoleId(roles.get("finish")?.id ?? null);
    },
    []
  );

  // Diff: holds added/removed since last save
  const holdsDiff = useMemo(() => {
    const savedSet = new Set(
      savedHolds.map((h) => `${h.placementId}:${h.roleId}`)
    );
    const currentSet = new Set(
      selectedHolds.map((h) => `${h.placementId}:${h.roleId}`)
    );
    let added = 0;
    let removed = 0;
    for (const key of currentSet) {
      if (!savedSet.has(key)) added++;
    }
    for (const key of savedSet) {
      if (!currentSet.has(key)) removed++;
    }
    return { added, removed };
  }, [selectedHolds, savedHolds]);

  const hasChanges = useMemo(() => {
    if (holdsDiff.added > 0 || holdsDiff.removed > 0) return true;
    if (name.trim() !== savedName) return true;
    if (description.trim() !== savedDescription) return true;
    if (allowMatching !== savedAllowMatching) return true;
    return false;
  }, [
    holdsDiff,
    name,
    savedName,
    description,
    savedDescription,
    allowMatching,
    savedAllowMatching,
  ]);

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

  const doSave = useCallback(
    async (asDraft: boolean) => {
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
          isDraft: asDraft,
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
          is_draft: asDraft ? 1 : 0,
          is_listed: 1,
          edge_left: 0,
          edge_right: 0,
          edge_bottom: 0,
          edge_top: 0,
          angle,
        });

        setIsDraft(asDraft);
        setSuccess(true);
        setShowPanel(false);
        setSavedHolds([...selectedHolds]);
        setSavedName(name.trim());
        setSavedDescription(description.trim());
        setSavedAllowMatching(allowMatching);
        if (!editUuid) {
          setEditUuid(uuid);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Save failed");
      } finally {
        setSaving(false);
      }
    },
    [
      token,
      userId,
      username,
      name,
      description,
      allowMatching,
      editUuid,
      buildFrames,
      angle,
      selectedHolds,
    ]
  );

  const handleSave = useCallback(() => doSave(isDraft), [doSave, isDraft]);
  const handlePublish = useCallback(() => doSave(false), [doSave]);

  const handleDelete = useCallback(async () => {
    if (!editUuid) return;
    setDeleting(true);
    try {
      if (token) {
        await deleteClimb(token, editUuid);
      }
      const db = await getDB();
      await db.delete("climbs", editUuid);
      onBack();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
      setDeleting(false);
      setConfirmDelete(false);
    }
  }, [editUuid, token, onBack]);

  function handleBleTap() {
    if (bleIsSending || bleStatus === "scanning" || bleStatus === "connecting")
      return;

    if (bleStatus === "connected") {
      if (confirmingBleDisconnect) {
        if (bleTimerRef.current) clearTimeout(bleTimerRef.current);
        setConfirmingBleDisconnect(false);
        disconnect();
      } else {
        setConfirmingBleDisconnect(true);
        bleTimerRef.current = setTimeout(
          () => setConfirmingBleDisconnect(false),
          2000
        );
      }
    } else {
      requestConnection();
    }
  }

  const isEditMode = editUuid !== null;

  const bleFill = confirmingBleDisconnect
    ? "#f87171"
    : bleIsSending
      ? "#4ade80"
      : bleStatus === "scanning" || bleStatus === "connecting"
        ? "#60a5fa"
        : bleStatus === "connected"
          ? "#fbbf24"
          : "#737373";
  const blePulse =
    bleIsSending || bleStatus === "scanning" || bleStatus === "connecting";

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
        {confirmDelete ? (
          <>
            <span className="flex-1 text-sm text-neutral-400">
              Delete this climb?
            </span>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="rounded-xl bg-red-600 px-5 py-2.5 text-sm font-semibold text-white active:bg-red-500 disabled:opacity-50"
            >
              {deleting ? "..." : "Delete"}
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="rounded-xl bg-neutral-700 px-4 py-2.5 text-sm text-neutral-300 active:bg-neutral-600"
            >
              Cancel
            </button>
          </>
        ) : confirmPublish ? (
          <>
            <span className="flex-1 text-sm text-neutral-400">
              Publish? Can&apos;t undo.
            </span>
            <button
              onClick={() => {
                handlePublish();
                setConfirmPublish(false);
              }}
              disabled={saving}
              className="rounded-xl bg-green-700 px-5 py-2.5 text-sm font-semibold text-white active:bg-green-600 disabled:opacity-50"
            >
              {saving ? "..." : "Publish"}
            </button>
            <button
              onClick={() => setConfirmPublish(false)}
              className="rounded-xl bg-neutral-700 px-4 py-2.5 text-sm text-neutral-300 active:bg-neutral-600"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              onClick={onBack}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-neutral-400 active:bg-neutral-800"
            >
              <svg
                width="22"
                height="22"
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
            <div className="flex-1" />

            {/* Header actions */}
            {isEditMode && (
              <button
                onClick={() => setConfirmDelete(true)}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-neutral-500 active:bg-neutral-800 active:text-red-400"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            )}
            {isEditMode && isDraft && (
              <button
                onClick={() => setConfirmPublish(true)}
                disabled={!canProceed || !name.trim()}
                className="rounded-xl bg-green-700 px-5 py-2.5 text-sm font-semibold text-white active:bg-green-600 disabled:bg-neutral-700 disabled:text-neutral-500"
              >
                Publish
              </button>
            )}
            <button
              onClick={() => setShowPanel(true)}
              disabled={!isEditMode && !canProceed}
              className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors active:bg-blue-500 disabled:bg-neutral-700 disabled:text-neutral-500"
            >
              {isEditMode ? (hasChanges ? "Save" : "Edit") : "Next"}
            </button>
          </>
        )}
      </div>

      {/* Board */}
      <div className="relative flex-1 min-h-0">
        <InteractiveBoardView
          selectedHolds={selectedHolds}
          onHoldsChange={handleHoldsChange}
          onRolesLoaded={handleRolesLoaded}
          className="h-full"
        />

        {/* Floating title overlay */}
        {isEditMode && (
          <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
            <div className="text-center">
              <p className="text-lg font-bold text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)]">
                {name || "Untitled"}
              </p>
              <p className="text-sm text-neutral-300 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
                {isDraft ? "Draft" : "Published"}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Bottom toolbar */}
      <div className="shrink-0 flex items-center justify-between border-t border-neutral-800 bg-neutral-900 px-4 py-2">
        {/* BLE button */}
        <button
          onClick={handleBleTap}
          className={`flex items-center justify-center rounded-xl border px-4 py-3.5 transition-colors ${
            confirmingBleDisconnect
              ? "border-red-500/50 bg-red-600/20 active:bg-red-600/30"
              : "border-neutral-600 hover:bg-neutral-700/50 active:bg-neutral-700"
          }`}
        >
          {confirmingBleDisconnect ? (
            <svg width="20" height="20" viewBox="0 0 20 20" fill="#f87171">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          ) : (
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill={bleFill}
              className={blePulse ? "animate-pulse" : ""}
            >
              <path d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z" />
            </svg>
          )}
        </button>

        <div className="flex overflow-visible rounded-xl border border-neutral-600">
          <button
            onClick={handleUndo}
            disabled={undoStack.length === 0}
            className="flex items-center justify-center rounded-l-xl px-5 py-3.5 text-neutral-400 transition-colors hover:bg-neutral-700/50 active:bg-neutral-700 disabled:text-neutral-700"
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
              <path d="M3 7v6h6" />
              <path d="M3 13c0 0 2.5-7.5 11-7.5 5 0 7 3.5 7 7s-2 7-7 7c-3.5 0-6-2-7.5-4.5" />
            </svg>
          </button>
          <button
            onClick={handleRedo}
            disabled={redoStack.length === 0}
            className="flex items-center justify-center rounded-r-xl border-l border-neutral-600 px-5 py-3.5 text-neutral-400 transition-colors hover:bg-neutral-700/50 active:bg-neutral-700 disabled:text-neutral-700"
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
              <path d="M21 7v6h-6" />
              <path d="M21 13c0 0-2.5-7.5-11-7.5-5 0-7 3.5-7 7s2 7 7 7c3.5 0 6-2 7.5-4.5" />
            </svg>
          </button>
        </div>
      </div>

      {/* Success toast */}
      {success && (
        <div className="absolute left-4 right-4 bottom-16 rounded-lg bg-green-900/80 px-4 py-2 text-center text-sm text-green-300">
          {!isDraft
            ? "Published!"
            : isEditMode && !initialClimbUuid
              ? "Climb created!"
              : "Saved!"}
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
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-neutral-400">
                  Allow matching
                </span>
                <SegmentedToggle
                  value={allowMatching}
                  onChange={setAllowMatching}
                />
              </div>

              {!isEditMode && (
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-neutral-400">
                    Save as draft
                  </span>
                  <SegmentedToggle value={isDraft} onChange={setIsDraft} />
                </div>
              )}

              {!isEditMode && (
                <p className="text-xs text-neutral-500">
                  You can edit your Draft boulders before publishing them to the
                  community. Once published, a boulder can no longer be edited.
                </p>
              )}

              {isEditMode &&
                (holdsDiff.added > 0 || holdsDiff.removed > 0) && (
                  <p className="text-xs text-neutral-400">
                    {[
                      holdsDiff.added > 0 &&
                        `${holdsDiff.added} hold${holdsDiff.added !== 1 ? "s" : ""} added`,
                      holdsDiff.removed > 0 &&
                        `${holdsDiff.removed} hold${holdsDiff.removed !== 1 ? "s" : ""} removed`,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                  </p>
                )}

              {error && <p className="text-sm text-red-400">{error}</p>}

              <button
                onClick={handleSave}
                disabled={saving || !name.trim() || (isEditMode && !hasChanges)}
                className="w-full rounded-lg bg-blue-600 py-3 text-sm font-semibold text-white transition-colors active:bg-blue-500 disabled:bg-neutral-700 disabled:text-neutral-500"
              >
                {saving
                  ? "Saving..."
                  : isEditMode && !hasChanges
                    ? "No changes"
                    : "Save"}
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

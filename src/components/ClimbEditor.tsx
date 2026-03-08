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
import { buildForkTag, parseForkSource, stripForkTag } from "@/lib/utils/fork";
import { requestConnection, resume, pause, disconnect } from "@/lib/ble/connection";
import { lightUpClimb } from "@/lib/ble/commands";
import { useTabStore, type ForkData } from "@/store/tabStore";
import { useDeckStore } from "@/store/deckStore";
import { invalidateForkCache, type ClimbResult } from "@/lib/db/queries";

const LAYOUT_ID = 8;

interface ClimbEditorProps {
  initialClimbUuid?: string;
  forkFrom?: ForkData;
  onBack: () => void;
}

export function ClimbEditor({ initialClimbUuid, forkFrom, onBack }: ClimbEditorProps) {
  const { token, userId, username } = useAuthStore();
  const angle = useFilterStore((s) => s.angle);
  const bleStatus = useBleStore((s) => s.status);
  const bleIsSending = useBleStore((s) => s.isSending);
  const forkHolds = useMemo(
    () => (forkFrom ? parseFrames(forkFrom.frames) : []),
    [forkFrom]
  );
  const [selectedHolds, setSelectedHolds] = useState<SelectedHold[]>(forkHolds);
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
  const [forkSourceName, setForkSourceName] = useState<string | null>(
    forkFrom?.sourceName ?? null
  );
  const [showGhosts, setShowGhosts] = useState(true);
  const [loadedForkHolds, setLoadedForkHolds] = useState<SelectedHold[]>([]);
  const [loadedForkSourceUuid, setLoadedForkSourceUuid] = useState<string | null>(null);

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
  const bleJustConnectedRef = useRef(false);

  // BLE disconnect confirm (double-tap pattern)
  const [confirmingBleDisconnect, setConfirmingBleDisconnect] = useState(false);
  const bleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevBleStatusRef = useRef(bleStatus);
  useEffect(() => {
    if (bleStatus !== "connected") setConfirmingBleDisconnect(false);
    // Track when BLE transitions to connected
    if (bleStatus === "connected" && prevBleStatusRef.current !== "connected") {
      bleJustConnectedRef.current = true;
    }
    prevBleStatusRef.current = bleStatus;
  }, [bleStatus]);
  useEffect(
    () => () => {
      if (bleTimerRef.current) clearTimeout(bleTimerRef.current);
    },
    []
  );

  // Auto light-up board when holds change or BLE connects
  useEffect(() => {
    if (selectedHolds.length === 0) return;
    if (bleStatus !== "connected") return;
    // Skip initial load — only fire after user edits or BLE (re)connects
    if (!userEditedRef.current && !bleJustConnectedRef.current) return;
    bleJustConnectedRef.current = false;

    const frames = selectedHolds
      .map((h) => `p${h.placementId}r${h.roleId}`)
      .join("");
    lightUpClimb(frames);
  }, [selectedHolds, bleStatus]);

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
          setDescription(stripForkTag(climb.description));
          setIsDraft(climb.is_draft === 1);
          setSelectedHolds(holds);
          setSavedHolds(holds);
          setSavedName(climb.name);
          setSavedDescription(stripForkTag(climb.description));

          // Look up fork source for ghost holds + name
          const sourceUuid = parseForkSource(climb.description);
          if (sourceUuid) {
            setLoadedForkSourceUuid(sourceUuid);
            const source = await db.get("climbs", sourceUuid);
            if (source) {
              setForkSourceName(source.name);
              setLoadedForkHolds(parseFrames(source.frames));
            }
          }
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

        // Append fork tag (kept out of the editable description)
        let finalDescription = description.trim();
        const sourceUuid = forkFrom?.sourceUuid ?? loadedForkSourceUuid;
        if (sourceUuid) {
          const tag = buildForkTag(sourceUuid);
          finalDescription = finalDescription ? `${finalDescription} ${tag}` : tag;
        }

        await saveClimb(token, {
          uuid,
          layoutId: LAYOUT_ID,
          setterId: userId,
          name: name.trim(),
          description: finalDescription,
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
          description: finalDescription,
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
        if (forkFrom) invalidateForkCache();
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
      forkFrom,
      loadedForkSourceUuid,
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

    if (bleStatus === "paused") {
      // Resume paused connection — instant, no picker
      resume();
      return;
    }

    if (bleStatus === "connected") {
      if (confirmingBleDisconnect) {
        // Second tap — pause (keep connection alive, stop sending)
        if (bleTimerRef.current) clearTimeout(bleTimerRef.current);
        setConfirmingBleDisconnect(false);
        pause();
      } else {
        // First tap — light up current holds + enter pause-confirm window
        if (selectedHolds.length > 0) {
          const frames = selectedHolds
            .map((h) => `p${h.placementId}r${h.roleId}`)
            .join("");
          lightUpClimb(frames);
        }
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
          : bleStatus === "paused"
            ? "#78716c" // warm gray — paused but resumable
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

        {/* Ghost toggle (fork only) */}
        {(forkFrom || forkSourceName) && (
          <button
            onClick={() => setShowGhosts((v) => !v)}
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors ${showGhosts ? "text-blue-400 bg-blue-400/10" : "text-neutral-600 active:bg-neutral-800"}`}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M9,7.82929429 L9,12 L12,12 C13.6568542,12 15,10.6568542 15,9 L15,7.82929429 C13.8348076,7.41745788 13,6.30621883 13,5 C13,3.34314575 14.3431458,2 16,2 C17.6568542,2 19,3.34314575 19,5 C19,6.30621883 18.1651924,7.41745788 17,7.82929429 L17,9 C17,11.7614237 14.7614237,14 12,14 L9,14 L9,16.1707057 C10.1651924,16.5825421 11,17.6937812 11,19 C11,20.6568542 9.65685425,22 8,22 C6.34314575,22 5,20.6568542 5,19 C5,17.6937812 5.83480763,16.5825421 7,16.1707057 L7,7.82929429 C5.83480763,7.41745788 5,6.30621883 5,5 C5,3.34314575 6.34314575,2 8,2 C9.65685425,2 11,3.34314575 11,5 C11,6.30621883 10.1651924,7.41745788 9,7.82929429 Z M8,20 C8.55228475,20 9,19.5522847 9,19 C9,18.4477153 8.55228475,18 8,18 C7.44771525,18 7,18.4477153 7,19 C7,19.5522847 7.44771525,20 8,20 Z M16,6 C16.5522847,6 17,5.55228475 17,5 C17,4.44771525 16.5522847,4 16,4 C15.4477153,4 15,4.44771525 15,5 C15,5.55228475 15.4477153,6 16,6 Z M8,6 C8.55228475,6 9,5.55228475 9,5 C9,4.44771525 8.55228475,4 8,4 C7.44771525,4 7,4.44771525 7,5 C7,5.55228475 7.44771525,6 8,6 Z" />
            </svg>
          </button>
        )}

        {/* Undo/redo */}
        <button
          onClick={handleUndo}
          disabled={undoStack.length === 0}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-neutral-400 active:bg-neutral-800 disabled:text-neutral-700"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 7H15C16.8692 7 17.8039 7 18.5 7.40193C18.9561 7.66523 19.3348 8.04394 19.5981 8.49999C20 9.19615 20 10.1308 20 12C20 13.8692 20 14.8038 19.5981 15.5C19.3348 15.9561 18.9561 16.3348 18.5 16.5981C17.8039 17 16.8692 17 15 17H8.00001M4 7L7 4M4 7L7 10" />
          </svg>
        </button>
        <button
          onClick={handleRedo}
          disabled={redoStack.length === 0}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-neutral-400 active:bg-neutral-800 disabled:text-neutral-700"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <g transform="translate(24,0) scale(-1,1)">
              <path d="M4 7H15C16.8692 7 17.8039 7 18.5 7.40193C18.9561 7.66523 19.3348 8.04394 19.5981 8.49999C20 9.19615 20 10.1308 20 12C20 13.8692 20 14.8038 19.5981 15.5C19.3348 15.9561 18.9561 16.3348 18.5 16.5981C17.8039 17 16.8692 17 15 17H8.00001M4 7L7 4M4 7L7 10" />
            </g>
          </svg>
        </button>

        {/* BLE button */}
        <button
          onClick={handleBleTap}
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors ${
            confirmingBleDisconnect
              ? "bg-red-600/20 active:bg-red-600/30"
              : "active:bg-neutral-800"
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
      </div>

      {/* Board */}
      <div className="relative flex-1 min-h-0">
        <InteractiveBoardView
          selectedHolds={selectedHolds}
          ghostHolds={showGhosts ? (forkFrom ? forkHolds : loadedForkHolds.length > 0 ? loadedForkHolds : undefined) : undefined}
          onHoldsChange={handleHoldsChange}
          onRolesLoaded={handleRolesLoaded}
          className="h-full"
        />

        {/* Floating overlay */}
        {(isEditMode || forkFrom) && (
          <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
            <div className="text-center">
              {isEditMode && (
                <p className="text-lg font-bold text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)]">
                  {name || "Untitled"}
                </p>
              )}
              {isEditMode && (
                <p className={`text-sm drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)] ${isDraft ? "text-red-400/70" : "text-neutral-300"}`}>
                  {isDraft ? "Draft" : "Published"}
                </p>
              )}
              {(forkSourceName ?? forkFrom?.sourceName) && (
                <p className="text-sm drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
                  <span className="text-neutral-500">forked from </span>
                  <button
                    className="pointer-events-auto text-neutral-200 underline decoration-neutral-500 active:text-neutral-400"
                    onClick={async () => {
                      const sourceUuid = forkFrom?.sourceUuid ?? loadedForkSourceUuid;
                      if (!sourceUuid) return;
                      const db = await getDB();
                      const climb = await db.get("climbs", sourceUuid);
                      if (!climb) return;
                      const stats = await db.get("climb_stats", [sourceUuid, angle]);
                      const result: ClimbResult = {
                        uuid: climb.uuid,
                        name: climb.name,
                        setter_username: climb.setter_username,
                        frames: climb.frames,
                        layout_id: climb.layout_id,
                        edge_left: climb.edge_left,
                        edge_right: climb.edge_right,
                        edge_bottom: climb.edge_bottom,
                        edge_top: climb.edge_top,
                        angle: stats?.angle ?? angle,
                        display_difficulty: stats?.display_difficulty ?? 0,
                        benchmark_difficulty: stats?.benchmark_difficulty ?? null,
                        difficulty_average: stats?.difficulty_average ?? 0,
                        quality_average: stats?.quality_average ?? 0,
                        ascensionist_count: stats?.ascensionist_count ?? 0,
                        last_climbed_at: null,
                      };
                      useDeckStore.getState().setDeck([result]);
                      useTabStore.getState().setTab("randomizer");
                      window.history.pushState({ from: "deck" }, "", "/randomizer");
                    }}
                  >
                    {forkSourceName ?? forkFrom?.sourceName}
                  </button>
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Bottom toolbar */}
      <div className="shrink-0 flex items-center justify-between border-t border-neutral-800 bg-neutral-900 px-4 py-2">
        {confirmDelete ? (
          <>
            <span className="flex-1 text-sm text-neutral-400">
              Delete this climb?
            </span>
            <div className="flex gap-1.5">
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="rounded-xl bg-red-600 px-5 py-3.5 text-sm font-semibold text-white active:bg-red-500 disabled:opacity-50"
              >
                {deleting ? "..." : "Delete"}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="rounded-xl bg-neutral-700 px-4 py-3.5 text-sm text-neutral-300 active:bg-neutral-600"
              >
                Cancel
              </button>
            </div>
          </>
        ) : confirmPublish ? (
          <>
            <span className="flex-1 text-sm text-neutral-400">
              Publish? Can&apos;t undo.
            </span>
            <div className="flex gap-1.5">
              <button
                onClick={() => {
                  handlePublish();
                  setConfirmPublish(false);
                }}
                disabled={saving}
                className="rounded-xl bg-green-700 px-5 py-3.5 text-sm font-semibold text-white active:bg-green-600 disabled:opacity-50"
              >
                {saving ? "..." : "Publish"}
              </button>
              <button
                onClick={() => setConfirmPublish(false)}
                className="rounded-xl bg-neutral-700 px-4 py-3.5 text-sm text-neutral-300 active:bg-neutral-600"
              >
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <div />

            <div className="flex items-center gap-1.5">
              {!isEditMode && !hasStart && (
                <span className="text-xs text-neutral-500">Need start</span>
              )}
              {!isEditMode && !hasFinish && (
                <span className="text-xs text-neutral-500">
                  {!hasStart ? "+ finish" : "Need finish"}
                </span>
              )}
              {isEditMode && (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="flex items-center justify-center rounded-xl border border-neutral-600 px-4 py-3.5 text-neutral-500 transition-colors hover:bg-neutral-700/50 active:bg-neutral-700 active:text-red-400"
                >
                  <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
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
                  className="rounded-xl bg-green-700 px-5 py-3.5 text-sm font-semibold text-white active:bg-green-600 disabled:bg-neutral-700 disabled:text-neutral-500"
                >
                  Publish
                </button>
              )}
              <button
                onClick={() => setShowPanel(true)}
                disabled={!isEditMode && !canProceed}
                className="rounded-xl bg-blue-600 px-5 py-3.5 text-sm font-semibold text-white transition-colors active:bg-blue-500 disabled:bg-neutral-700 disabled:text-neutral-500"
              >
                {isEditMode ? (hasChanges ? "Save" : "Edit") : "Next"}
              </button>
            </div>
          </>
        )}
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

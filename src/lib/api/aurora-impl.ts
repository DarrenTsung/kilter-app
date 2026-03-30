/**
 * Aurora API implementation of BoardApi.
 *
 * Kept intact for reference and in case a replacement API materializes.
 * Currently unused — the app binds to noopApi in index.ts.
 */

import type {
  BoardApi,
  LoginSession,
  AscentData,
  BidData,
  ClimbSaveData,
  CircuitCreateData,
  ApiBetaLink,
  SyncProgress,
} from "./interface";
import { generateUUID } from "./uuid";
import { syncSharedData as doSyncShared, syncUserData as doSyncUser } from "@/lib/db/sync";

const API_BASE = "/api/aurora";

async function login(
  username: string,
  password: string,
): Promise<LoginSession> {
  const response = await fetch(`${API_BASE}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username,
      password,
      tou: "accepted",
      pp: "accepted",
      ua: "app",
    }),
  });

  if (response.status === 422) {
    throw new Error("Invalid username or password");
  }

  if (!response.ok) {
    throw new Error(`Login failed (${response.status})`);
  }

  const data = await response.json();
  return data.session;
}

async function saveCircuitClimbs(
  token: string,
  circuitUuid: string,
  climbUuids: string[],
): Promise<void> {
  const params = new URLSearchParams();
  params.set("circuit_uuid", circuitUuid);
  for (const uuid of climbUuids) {
    params.append("climb_uuids[]", uuid);
  }

  const response = await fetch(`${API_BASE}/circuit_climbs/save`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Aurora-Token": token,
    },
    body: params.toString(),
  });

  if (!response.ok) {
    throw new Error(`Failed to save circuit climbs (${response.status})`);
  }
}

async function saveTag(
  token: string,
  userId: number,
  climbUuid: string,
  isBlocked: boolean,
): Promise<void> {
  const formBody = new URLSearchParams({
    entity_uuid: climbUuid,
    user_id: String(userId),
    name: "~block",
    is_listed: isBlocked ? "1" : "0",
  }).toString();

  const response = await fetch(`${API_BASE}/tags/save`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Aurora-Token": token,
    },
    body: formBody,
  });

  if (!response.ok) {
    throw new Error(`Failed to save tag (${response.status})`);
  }
}

async function fetchClimbBeta(
  token: string,
  climbUuid: string,
): Promise<ApiBetaLink[]> {
  const response = await fetch(`${API_BASE}/climbs/${climbUuid}/beta`, {
    headers: { "X-Aurora-Token": token },
  });

  if (!response.ok) return [];

  const data = await response.json();
  const links: ApiBetaLink[] = data.links ?? [];
  return links.filter((l) => l.is_listed);
}

async function checkLinksValid(urls: string[]): Promise<Set<string>> {
  if (urls.length === 0) return new Set();
  try {
    const response = await fetch("/api/check-links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls }),
    });
    if (!response.ok) return new Set(urls);
    const { valid } = await response.json();
    return new Set(valid);
  } catch {
    return new Set(urls);
  }
}

async function createCircuit(
  token: string,
  circuit: CircuitCreateData,
): Promise<void> {
  const formBody = new URLSearchParams({
    uuid: circuit.uuid,
    user_id: String(circuit.userId),
    name: circuit.name,
    description: circuit.description,
    color: circuit.color,
    is_public: circuit.isPublic ? "1" : "0",
  }).toString();

  const response = await fetch(`${API_BASE}/circuits/save`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Aurora-Token": token,
    },
    body: formBody,
  });

  if (!response.ok) {
    throw new Error(`Failed to create circuit (${response.status})`);
  }
}

async function saveClimb(
  token: string,
  data: ClimbSaveData,
): Promise<void> {
  const formBody = new URLSearchParams({
    uuid: data.uuid,
    layout_id: String(data.layoutId),
    setter_id: String(data.setterId),
    name: data.name,
    description: data.description,
    is_nomatch: data.isNoMatch ? "1" : "0",
    is_draft: data.isDraft ? "1" : "0",
    frames_count: "1",
    frames_pace: "0",
    frames: data.frames,
    angle: String(data.angle),
  }).toString();

  const response = await fetch(`${API_BASE}/climbs/save`, {
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
    throw new Error(`Save failed (${response.status}): ${body}`);
  }
}

async function logAscent(
  token: string,
  userId: number,
  data: AscentData,
): Promise<string> {
  const uuid = generateUUID();
  const climbed_at = data.climbed_at ?? (() => {
    const now = new Date();
    return now.toLocaleString("sv").slice(0, 19) +
      "." + String(now.getMilliseconds()).padStart(3, "0") + "000";
  })();

  const formBody = new URLSearchParams({
    uuid,
    user_id: String(userId),
    climb_uuid: data.climb_uuid,
    angle: String(data.angle),
    is_mirror: "0",
    bid_count: String(data.bid_count),
    quality: String(data.quality),
    difficulty: String(data.difficulty),
    is_benchmark: "0",
    comment: data.comment,
    climbed_at,
  }).toString();

  const response = await fetch(`${API_BASE}/ascents/save`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Aurora-Token": token,
    },
    body: formBody,
  });

  if (!response.ok) {
    throw new Error(`Failed to log ascent (${response.status})`);
  }

  return uuid;
}

async function logBid(
  token: string,
  userId: number,
  data: BidData,
): Promise<string> {
  const uuid = generateUUID();
  const climbed_at = data.climbed_at ?? (() => {
    const now = new Date();
    return now.toLocaleString("sv").slice(0, 19) +
      "." + String(now.getMilliseconds()).padStart(3, "0") + "000";
  })();

  const formBody = new URLSearchParams({
    uuid,
    user_id: String(userId),
    climb_uuid: data.climb_uuid,
    angle: String(data.angle),
    is_mirror: "0",
    bid_count: String(data.bid_count),
    comment: data.comment,
    climbed_at,
  }).toString();

  const response = await fetch(`${API_BASE}/bids/save`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Aurora-Token": token,
    },
    body: formBody,
  });

  if (!response.ok) {
    throw new Error(`Failed to log bid (${response.status})`);
  }

  return uuid;
}

async function deleteClimb(token: string, uuid: string): Promise<void> {
  const response = await fetch(`${API_BASE}/climbs/delete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Aurora-Token": token,
    },
    body: new URLSearchParams({ uuid }).toString(),
  });
  if (!response.ok) {
    throw new Error(`Failed to delete climb (${response.status})`);
  }
}

async function deleteAscent(token: string, uuid: string): Promise<void> {
  const response = await fetch(`${API_BASE}/ascents/delete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Aurora-Token": token,
    },
    body: new URLSearchParams({ uuid }).toString(),
  });
  if (!response.ok) {
    throw new Error(`Failed to delete ascent (${response.status})`);
  }
}

async function deleteCircuit(token: string, uuid: string): Promise<void> {
  const response = await fetch(`${API_BASE}/circuits/delete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Aurora-Token": token,
    },
    body: new URLSearchParams({ uuid }).toString(),
  });
  if (!response.ok) {
    throw new Error(`Failed to delete circuit (${response.status})`);
  }
}

async function deleteBid(token: string, uuid: string): Promise<void> {
  const response = await fetch(`${API_BASE}/bids/delete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Aurora-Token": token,
    },
    body: new URLSearchParams({ uuid }).toString(),
  });
  const body = await response.text();
  console.log(`[deleteBid] ${response.status} body:`, body);
  if (!response.ok) {
    throw new Error(`Failed to delete bid (${response.status}): ${body}`);
  }
}

export const auroraApi: BoardApi = {
  login,
  logAscent,
  logBid,
  deleteAscent,
  deleteBid,
  saveClimb,
  deleteClimb,
  createCircuit,
  deleteCircuit,
  saveCircuitClimbs,
  saveTag,
  fetchClimbBeta,
  checkLinksValid,
  syncSharedData: (
    token: string,
    onProgress?: (progress: SyncProgress) => void,
    signal?: AbortSignal,
  ) => doSyncShared(token, onProgress, signal),
  syncUserData: (
    token: string,
    userId: number,
    onProgress?: (progress: SyncProgress) => void,
    signal?: AbortSignal,
  ) => doSyncUser(token, userId, onProgress, signal),
};

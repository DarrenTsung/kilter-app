const API_BASE = "/api/aurora";

export interface LoginSession {
  token: string;
  user_id: number;
}

export async function login(
  username: string,
  password: string
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

/** Add or update climbs in a circuit */
export async function saveCircuitClimbs(
  token: string,
  circuitUuid: string,
  climbUuids: string[]
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

/** Block or unblock a climb via the Aurora tags system */
export async function saveTag(
  token: string,
  userId: number,
  climbUuid: string,
  isBlocked: boolean
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

export interface ApiBetaLink {
  climb_uuid: string;
  foreign_username?: string | null;
  link: string;
  angle: number | null;
  is_listed: boolean;
}

/** Fetch beta video links for a climb from the API */
export async function fetchClimbBeta(
  token: string,
  climbUuid: string
): Promise<ApiBetaLink[]> {
  const response = await fetch(`${API_BASE}/climbs/${climbUuid}/beta`, {
    headers: { "X-Aurora-Token": token },
  });

  if (!response.ok) return [];

  const data = await response.json();
  const links: ApiBetaLink[] = data.links ?? [];
  return links.filter((l) => l.is_listed);
}

/** Check which URLs are still publicly accessible */
export async function checkLinksValid(urls: string[]): Promise<Set<string>> {
  if (urls.length === 0) return new Set();
  try {
    const response = await fetch("/api/check-links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls }),
    });
    if (!response.ok) return new Set(urls); // assume valid on error
    const { valid } = await response.json();
    return new Set(valid);
  } catch {
    return new Set(urls); // assume valid on error
  }
}

/** Generate a UUID v4 without hyphens (32 hex chars), matching boardlib format */
export function generateUUID(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replace(/-/g, "");
  }
  // Fallback for browsers without randomUUID (e.g. older Android WebView)
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Create a new circuit on the Aurora API */
export async function createCircuit(
  token: string,
  circuit: {
    uuid: string;
    userId: number;
    name: string;
    description: string;
    color: string;
    isPublic: boolean;
  }
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

export interface ClimbSaveData {
  uuid: string;
  layoutId: number;
  setterId: number;
  name: string;
  description: string;
  frames: string;
  angle: number;
  isDraft: boolean;
  isNoMatch: boolean;
}

/** Save (create or update) a climb on the Aurora API */
export async function saveClimb(
  token: string,
  data: ClimbSaveData
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

export interface AscentData {
  climb_uuid: string;
  angle: number;
  bid_count: number;
  quality: number;
  difficulty: number;
  comment: string;
  climbed_at?: string;
}

/** Log an ascent to the Aurora API and return the generated UUID */
export async function logAscent(
  token: string,
  userId: number,
  data: AscentData
): Promise<string> {
  const uuid = generateUUID();
  // Match APK format: yyyy-MM-dd HH:mm:ss.SSSSSS
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

export interface BidData {
  climb_uuid: string;
  angle: number;
  bid_count: number;
  comment: string;
  climbed_at?: string;
}

/** Log a bid (attempt without send) to the Aurora API and return the generated UUID */
export async function logBid(
  token: string,
  userId: number,
  data: BidData
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

/** Delete an ascent from the Aurora API */
export async function deleteAscent(token: string, uuid: string): Promise<void> {
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

/** Delete a circuit from the Aurora API */
export async function deleteCircuit(token: string, uuid: string): Promise<void> {
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

/** Delete a bid from the Aurora API */
export async function deleteBid(token: string, uuid: string): Promise<void> {
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

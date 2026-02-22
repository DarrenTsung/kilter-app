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
function generateUUID(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

export interface AscentData {
  climb_uuid: string;
  angle: number;
  bid_count: number;
  quality: number;
  difficulty: number;
  comment: string;
}

/** Log an ascent to the Aurora API and return the generated UUID */
export async function logAscent(
  token: string,
  userId: number,
  data: AscentData
): Promise<string> {
  const uuid = generateUUID();
  // Match APK format: yyyy-MM-dd HH:mm:ss.SSSSSS
  const now = new Date();
  const climbed_at =
    now.toLocaleString("sv").slice(0, 19) +
    "." +
    String(now.getMilliseconds()).padStart(3, "0") +
    "000";

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
  if (!response.ok) {
    throw new Error(`Failed to delete bid (${response.status})`);
  }
}

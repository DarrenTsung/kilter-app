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
  const climbed_at = new Date().toLocaleString("sv").slice(0, 19);

  const response = await fetch(`${API_BASE}/ascents/save/${uuid}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-Aurora-Token": token,
    },
    body: JSON.stringify({
      uuid,
      user_id: userId,
      climb_uuid: data.climb_uuid,
      angle: data.angle,
      is_mirror: 0,
      attempt_id: 0,
      bid_count: data.bid_count,
      quality: data.quality,
      difficulty: data.difficulty,
      is_benchmark: 0,
      comment: data.comment,
      climbed_at,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to log ascent (${response.status})`);
  }

  return uuid;
}

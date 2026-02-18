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

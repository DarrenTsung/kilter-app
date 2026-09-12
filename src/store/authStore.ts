import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AuthState {
  token: string | null;
  userId: number | null;
  username: string | null;
  isLoggedIn: boolean;
  isGuest: boolean;
  login: (token: string, userId: number, username: string) => void;
  loginAsGuest: (username: string) => void;
  logout: () => void;
}

const GUEST_REGISTRY_KEY = "kilter-guests";

/**
 * Guest accounts are local-only: no token, so nothing syncs to Aurora.
 * We assign a stable synthetic `userId` per guest name so drafts and
 * activity written locally stay attached to the same name across
 * sessions and logouts.
 */
function getGuestUserId(name: string): number {
  const key = name.trim().toLowerCase();
  try {
    const raw = localStorage.getItem(GUEST_REGISTRY_KEY);
    const map: Record<string, number> = raw ? JSON.parse(raw) : {};
    if (typeof map[key] === "number") return map[key];
    // Keep guest ids well above real Aurora user ids.
    const id = 1_000_000_000 + Math.floor(Math.random() * 1_000_000_000);
    map[key] = id;
    localStorage.setItem(GUEST_REGISTRY_KEY, JSON.stringify(map));
    return id;
  } catch {
    return 1_000_000_000 + Math.floor(Math.random() * 1_000_000_000);
  }
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      userId: null,
      username: null,
      isLoggedIn: false,
      isGuest: false,
      login: (token, userId, username) =>
        set({ token, userId, username, isLoggedIn: true, isGuest: false }),
      loginAsGuest: (username) =>
        set({
          token: null,
          userId: getGuestUserId(username),
          username: username.trim(),
          isLoggedIn: true,
          isGuest: true,
        }),
      logout: () =>
        set({
          token: null,
          userId: null,
          username: null,
          isLoggedIn: false,
          isGuest: false,
        }),
    }),
    { name: "kilter-auth" }
  )
);

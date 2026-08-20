import { create } from 'zustand';

export const knownRoles = ['ADMINISTRATOR', 'WAITER', 'CASHIER', 'STATION', 'RUNNER', 'EVENT_MANAGER', 'REVISION'] as const;
export type UserRole = (typeof knownRoles)[number];

export interface AuthUser {
  username: string;
  role: UserRole;
  userId: string;
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  setToken: (token: string) => void;
  logout: () => void;
}

interface JwtPayload {
  username?: unknown;
  sub?: unknown;
  role?: unknown;
  exp?: unknown;
}

const isKnownRole = (role: unknown): role is UserRole =>
  typeof role === 'string' && knownRoles.includes(role as UserRole);

const decodeToken = (token: string): AuthUser | null => {
  try {
    const tokenParts = token.split('.');
    if (tokenParts.length !== 3 || tokenParts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) return null;
    const payloadPart = tokenParts[1];

    const base64 = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
    const paddedBase64 = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const bytes = Uint8Array.from(atob(paddedBase64), (character) => character.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as JwtPayload;

    if (
      typeof payload.username !== 'string' ||
      !payload.username ||
      (typeof payload.sub !== 'string' && typeof payload.sub !== 'number') ||
      !String(payload.sub) ||
      !isKnownRole(payload.role) ||
      typeof payload.exp !== 'number' ||
      !Number.isFinite(payload.exp) ||
      payload.exp * 1000 <= Date.now()
    ) {
      return null;
    }

    return { username: payload.username, userId: String(payload.sub), role: payload.role };
  } catch {
    return null;
  }
};

const storedToken = localStorage.getItem('token');
const storedUser = storedToken ? decodeToken(storedToken) : null;

if (storedToken && !storedUser) localStorage.removeItem('token');

export const useAuthStore = create<AuthState>((set) => ({
  token: storedUser ? storedToken : null,
  user: storedUser,
  // Das Auslesen des Payloads dient ausschließlich der UI-Navigation. Das Backend bleibt autoritativ.
  setToken: (token) => {
    const user = decodeToken(token);
    if (!user) {
      localStorage.removeItem('token');
      set({ token: null, user: null });
      return;
    }

    localStorage.setItem('token', token);
    set({ token, user });
  },
  logout: () => {
    localStorage.removeItem('token');
    set({ token: null, user: null });
  },
}));

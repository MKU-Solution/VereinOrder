import { create } from 'zustand';

interface AuthState {
  token: string | null;
  user: { username: string; role: string; userId: string } | null;
  setToken: (token: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: localStorage.getItem('token') || null,
  user: null, // would decode JWT here ideally
  setToken: (token) => {
    localStorage.setItem('token', token);
    set({ token });
    // TODO: decode token and set user
  },
  logout: () => {
    localStorage.removeItem('token');
    set({ token: null, user: null });
  },
}));

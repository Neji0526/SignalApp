"use client";

import { create } from "zustand";
import { api, type SignalUser } from "@/lib/api";

const TOKEN_KEY = "signal-token";

interface AuthState {
  token: string | null;
  user: SignalUser | null;
  ready: boolean; // finished the initial token check
  init: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name?: string) => Promise<void>;
  logout: () => void;
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}


export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  user: null,
  ready: false,

  init: async () => {
    const token = getToken();
    if (!token) { set({ ready: true }); return; }
    try {
      const { user } = await api.me(token);
      set({ token, user, ready: true });
    } catch {
      localStorage.removeItem(TOKEN_KEY);
      set({ token: null, user: null, ready: true });
    }
  },

  login: async (email, password) => {
    const { token, user } = await api.login(email, password);
    localStorage.setItem(TOKEN_KEY, token);
    set({ token, user, ready: true });
  },

  register: async (email, password, name) => {
    const { token, user } = await api.register(email, password, name);
    localStorage.setItem(TOKEN_KEY, token);
    set({ token, user, ready: true });
  },

  logout: () => {
    localStorage.removeItem(TOKEN_KEY);
    set({ token: null, user: null });
  },
}));

"use client";

import { create } from "zustand";
import { api, WS_URL, type Signal } from "@/lib/api";
import { getToken } from "@/store/auth-store";

interface SignalsState {
  signals: Signal[];
  loading: boolean;
  live: boolean;
  load: () => Promise<void>;
  connect: () => void;
  disconnect: () => void;
}


let ws: WebSocket | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let attempts = 0;
/** Set by disconnect() so a deliberate close doesn't trigger the reconnect loop. */
let closedByUs = false;

const clearTimers = () => {
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
};

export const useSignalsStore = create<SignalsState>((set, get) => ({
  signals: [],
  loading: true,
  live: false,

  load: async () => {
    const token = getToken();
    if (!token) return;
    try {
      // All-time (capped), matching the admin Positions page rather than a 24h window.
      const signals = await api.signalsAll(token);
      set({ signals, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  connect: () => {
    if (ws || typeof window === "undefined") return;
    closedByUs = false;
    const token = getToken();
    if (!token) return;

    // While the socket is down, fall back to REST polling so the feed still moves.
    // The interval is cheap and stops the moment the socket is back.
    const startPolling = () => {
      if (pollTimer) return;
      pollTimer = setInterval(() => {
        if (document.visibilityState === "visible") void get().load();
      }, 5000);
    };

    const scheduleRetry = () => {
      if (closedByUs || retryTimer) return;
      // Exponential backoff capped at 15s — a backend redeploy shouldn't leave the
      // page permanently offline, but nor should we hammer a down server.
      const delay = Math.min(1000 * 2 ** attempts, 15_000);
      attempts += 1;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        get().connect();
      }, delay);
    };

    try {
      // Pass the token so the server filters the live push by this user's access.
      ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(token)}`);
      ws.onopen = () => {
        attempts = 0;
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
        set({ live: true });
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data) as { type: string; data: Signal[] };
          if (msg.type === "signals") set({ signals: msg.data, loading: false });
        } catch { /* ignore malformed frames */ }
      };
      ws.onclose = () => {
        ws = null;
        set({ live: false });
        startPolling();
        scheduleRetry();
      };
      ws.onerror = () => set({ live: false });
    } catch {
      ws = null;
      set({ live: false });
      startPolling();
      scheduleRetry();
    }
  },

  disconnect: () => {
    closedByUs = true;
    clearTimers();
    attempts = 0;
    ws?.close();
    ws = null;
    set({ live: false });
  },
}));

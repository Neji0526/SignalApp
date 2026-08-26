/* API client + shared types for the SignalBackend. */

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8100";
export const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8100/ws";

export interface SignalUser {
  id: string;
  email: string;
  name: string | null;
  role: "SUBSCRIBER" | "ADMIN";
  status: "ACTIVE" | "SUSPENDED";
}

export interface Signal {
  id: string;
  symbol: string;
  market: string;
  side: "LONG" | "SHORT";
  entry: number;
  stopLoss: number | null;
  takeProfit: number | null;
  exit: number | null;
  quantity: number;
  conviction: number;
  status: "active" | "closed";
  openedAt: number;
  closedAt: number | null;
  pnl: number | null;
  unrealizedPnl: number | null;
  win: boolean | null;
  locked?: boolean; // over the user's daily limit — price levels hidden
}

export const MARKETS = ["ES", "NQ", "YM", "GC", "CL"] as const;
export type Direction = "LONG" | "SHORT" | "BOTH";

export interface AccessConfig {
  markets: string[]; // [] = all markets
  direction: Direction;
  dailyLimit: number | null; // null = unlimited
  minConviction: number; // 1..4
  live: boolean; // see active/live signals
  suspended: boolean; // feed cut entirely
  allocationPercent: number; // 0-100: copy share of eligible signals (100 = all)
  maxCopiesPerDay: number | null; // admin hard cap on COPIED trades / rolling 24h; null = no cap
}

export interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  role: "SUBSCRIBER" | "ADMIN";
  status: "ACTIVE" | "SUSPENDED";
  createdAt: number;
  access: AccessConfig;
}

export interface Performance {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
  maxDrawdown: number;
  profitFactor: number;
  avgRR: number;
  avgWin: number;
  avgLoss: number;
  byMarket: { market: string; n: number; winRate: number; pnl: number }[];
  equityCurve: { day: string; value: number }[];
  recent: Signal[];
}

async function req<T>(path: string, opts: RequestInit = {}, token?: string | null): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(opts.headers as Record<string, string>) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

export const api = {
  register: (email: string, password: string, name?: string) =>
    req<{ token: string; user: SignalUser }>("/api/auth/register", { method: "POST", body: JSON.stringify({ email, password, name }) }),
  login: (email: string, password: string) =>
    req<{ token: string; user: SignalUser }>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  me: (token: string) => req<{ user: SignalUser }>("/api/auth/me", {}, token),
  signals: (token: string, hours = 24) => req<Signal[]>(`/api/signals?hours=${hours}`, {}, token),
  /** Every open signal + all closed (capped) — the admin Positions page's mirror. */
  signalsAll: (token: string) => req<Signal[]>("/api/signals?all=1", {}, token),
  /** Signals inside an explicit window (the chart's calendar range). */
  signalsRange: (token: string, sinceMs: number, untilMs?: number) => {
    const q = new URLSearchParams({ since: String(Math.max(0, Math.round(sinceMs))) });
    if (untilMs != null) q.set("until", String(Math.round(untilMs)));
    return req<Signal[]>(`/api/signals?${q.toString()}`, {}, token);
  },
  performance: (token: string, params: { sinceMs?: number; untilMs?: number; market?: string } = {}) => {
    const q = new URLSearchParams();
    // `sinceMs: 0` means all time — send it. A truthiness check would drop it and
    // silently fall back to the backend's 90-day default.
    if (params.sinceMs != null) q.set("since", String(params.sinceMs));
    if (params.untilMs != null) q.set("until", String(params.untilMs));
    if (params.market) q.set("market", params.market);
    return req<Performance>(`/api/performance?${q.toString()}`, {}, token);
  },
  chartHistory: (token: string, symbol: string, resolution: number, count = 300) =>
    req<Candle[]>(`/api/chart/history?symbol=${encodeURIComponent(symbol)}&resolution=${resolution}&count=${count}`, {}, token),

  // --- auto-copy ---
  copySettings: (token: string) => req<CopySettings>("/api/copy/settings", {}, token),
  updateCopySettings: (token: string, body: CopySettings) =>
    req<CopySettings>("/api/copy/settings", { method: "PUT", body: JSON.stringify(body) }, token),
  copyOrders: (token: string) => req<CopyOrder[]>("/api/copy/orders", {}, token),

  // --- admin ---
  adminListUsers: (token: string) => req<AdminUser[]>("/api/admin/users", {}, token),
  adminUpdateUser: (token: string, id: string, body: { access?: AccessConfig; status?: "ACTIVE" | "SUSPENDED"; password?: string }) =>
    req<{ ok: true }>(`/api/admin/users/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(body) }, token),
  adminGetRiskConfig: (token: string) => req<RiskConfig>("/api/admin/risk-config", {}, token),
  adminSetRiskConfig: (token: string, config: RiskConfig) =>
    req<RiskConfig>("/api/admin/risk-config", { method: "PUT", body: JSON.stringify(config) }, token),

  // --- dxFeed trade readiness ---
  adminReadiness: (token: string) => req<ReadinessView>("/api/admin/dxfeed/readiness", {}, token),
  // POST, not GET: this places a real probe order on the subscriber's account.
  adminRecheckReadiness: (token: string, userId: string) =>
    req<ReadinessResult>(`/api/admin/dxfeed/readiness/${encodeURIComponent(userId)}`, { method: "POST" }, token),
  // Creates a REAL trading account at the prop firm. Admin-only, never automatic
  // on registration. Idempotent: safe to retry on a partially provisioned user.
  adminProvisionDxFeed: (token: string, userId: string) =>
    req<{ dxUserId: string; dxAccountId: string | null }>(
      `/api/admin/dxfeed/provision/${encodeURIComponent(userId)}`, { method: "POST" }, token),
};

/* A dxFeed account can be fully provisioned, report itself enabled, and still
 * silently ignore orders — so the copy engine only routes to accounts proven by
 * a real probe order. `tradeVerifiedAt === null` means this subscriber's signals
 * are being SKIPPED, which is why the admin view leads with them. */
export interface ReadinessView {
  /** Which execution path the backend is actually running. On "atas" the whole
   *  dxFeed readiness view is meaningless, so the UI hides it. */
  adapter: "dxfeed" | "atas";
  rows: ReadinessRow[];
}

export interface ReadinessRow {
  userId: string;
  email: string;
  name: string | null;
  dxAccountId: string | null;
  accountStatus: number | null;
  tradeVerifiedAt: string | null;
  tradeProbeError: string | null;
}

export interface ReadinessResult {
  ready: boolean;
  reason: string | null;
  /** Nothing was learned — market closed or our session was down. Not the
   *  subscriber's fault, and deliberately not recorded against them. */
  inconclusive?: boolean;
}

/** Global DEFAULT base dollar risk per trade. A signal's risk = base × its
 *  conviction (1-4); the copier sizes in micro contracts to hit it. Each account
 *  can override this base in its own copy settings. */
export interface RiskConfig { baseRisk: number }

/** off = nothing; confirm = prepared, awaiting your approval; auto = placed for you. */
export type CopyMode = "off" | "confirm" | "auto";

export interface CopySettings {
  mode: CopyMode;
  markets: string[]; // [] = every market you can see
  minConviction: number; // 1..4
  // Base $ risk per trade; the copier risks baseRisk × the signal's conviction (1..4),
  // sized in micro contracts. The GET response resolves null to the global default,
  // so this is a concrete number in the UI.
  baseRisk: number | null;
  maxConcurrent: number;
  maxPerDay: number;
  /* Whether we would actually place trades for this account. Read-only, GET
   * only, and null on the ATAS pull deployment where the question is
   * meaningless. Copying can be switched on while this is false — the settings
   * save fine, the signals just get skipped — so the page has to say so. */
  tradeReady?: boolean | null;
  tradeBlockedReason?: string | null;
}

export type CopyOrderStatus =
  | "PENDING_CONFIRM" | "QUEUED" | "PLACED" | "REJECTED" | "SKIPPED" | "EXPIRED" | "ABANDONED";

export interface CopyOrder {
  id: string;
  signalId: string;
  symbol: string;
  side: "LONG" | "SHORT";
  quantity: number;
  status: CopyOrderStatus;
  reason: string | null;
  brokerOrderId: string | null;
  stopLoss: number | null;
  takeProfit: number | null;
  conviction: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface Candle {
  time: number; // epoch seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

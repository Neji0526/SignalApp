"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, Badge } from "@/components/ui";
import { api, API_BASE, MARKETS, type CopyMode, type CopyOrder, type CopySettings } from "@/lib/api";
import { getToken, useAuthStore } from "@/store/auth-store";
import { cn, timeAgo } from "@/lib/utils";

/* Automation — auto-copy settings + recent copy activity.
 *
 * The signal app never places orders into a broker itself: settings here decide
 * WHAT gets copied, and the subscriber's own terminal (an ATAS/NinjaTrader
 * strategy) collects the queued orders and places them through the broker it is
 * already connected to. We never hold broker credentials. */

/* Two deployments, two different things happening to the subscriber's order, and
 * the difference is not cosmetic: on the pull path we hand the order to THEIR
 * terminal and never touch a broker, while on the prop path we place it directly
 * on the account we issued them. Describing one as the other would misstate who
 * is executing, so the copy follows the deployment. */
const MODES: { value: CopyMode; label: string; hint: string; hintDirect?: string }[] = [
  { value: "off", label: "Off", hint: "Signals only — nothing is traded for you." },
  { value: "confirm", label: "Confirm each", hint: "An order is prepared; you approve it before it goes out." },
  {
    value: "auto",
    label: "Automatic",
    hint: "Orders are queued for your terminal without asking.",
    hintDirect: "Trades are placed on your account without asking.",
  },
];

const STATUS_TONE: Record<string, "long" | "short" | "warning" | "neutral" | "info"> = {
  PLACED: "long",
  QUEUED: "info",
  PENDING_CONFIRM: "warning",
  REJECTED: "short",
  ABANDONED: "short",
  SKIPPED: "neutral",
  EXPIRED: "neutral",
};

const STATUS_LABEL: Record<string, string> = {
  PLACED: "Placed",
  QUEUED: "Waiting for your terminal",
  PENDING_CONFIRM: "Needs your approval",
  REJECTED: "Rejected",
  ABANDONED: "Unconfirmed",
  SKIPPED: "Skipped",
  EXPIRED: "Expired",
};

export default function AutomationPage() {
  const [settings, setSettings] = useState<CopySettings | null>(null);
  const [orders, setOrders] = useState<CopyOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const email = useAuthStore((s) => s.user?.email) ?? "";

  const load = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    try {
      const [s, o] = await Promise.all([api.copySettings(token), api.copyOrders(token).catch(() => [])]);
      setSettings(s);
      setOrders(o);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = async (next: CopySettings) => {
    const token = getToken();
    if (!token) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      setSettings(await api.updateCopySettings(token, next));
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      // Revert on failure — the server may refuse (e.g. copying disabled
      // server-wide), and leaving the toggle showing "Automatic" would tell the
      // user their trades are being placed when they are not.
      setError((e as Error).message);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const patch = (p: Partial<CopySettings>) => { if (settings) void save({ ...settings, ...p }); };

  if (loading) return <div className="py-16 text-center text-sm text-muted">Loading…</div>;
  if (!settings) return <div className="py-16 text-center text-sm text-muted">{error ?? "Could not load settings."}</div>;

  // Server switch (AUTO_COPY_ENABLED) off: everything below is shown disabled and
  // the saved mode is displayed as Off without being overwritten.
  const disabled = settings.autoCopyEnabled === false;
  const mode: CopyMode = disabled ? "off" : settings.mode;
  const on = mode !== "off";
  // Readiness is only reported on the prop-account deployment; null means the
  // pull path, where we queue for the subscriber's own terminal instead.
  const direct = settings.executionAdapter === "dxfeed" || settings.tradeReady != null;
  const showTerminalSetup = settings.showTerminalSetup === true;

  return (
    <div>
      <div className="mb-5 flex items-center gap-3">
        <h1 className="text-xl font-semibold">Automation</h1>
        {disabled
          ? <Badge tone="neutral">Disabled</Badge>
          : on
            ? <Badge tone={mode === "auto" ? "long" : "warning"}>{mode === "auto" ? "Active" : "Confirm mode"}</Badge>
            : <Badge tone="neutral">Off</Badge>}
        {saving && <span className="text-xs text-muted">Saving…</span>}
        {saved && <span className="text-xs text-long">Saved</span>}
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-short/40 bg-short/10 px-3 py-2 text-sm text-short">{error}</div>
      )}

      {/* Switching copying on does NOT mean we can trade the account: it has to
        * have passed a live test order first, because a prop account can look
        * perfectly healthy and still ignore orders without rejecting them. Saying
        * "Active" while every signal is skipped is the one thing this page must
        * never do. Louder once copying is actually on — that is when the gap
        * between what the badge says and what happens becomes real. */}
      {disabled && (
        <div className="mb-4 rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-sm text-muted">
          <div className="font-medium text-foreground">Auto-copy is currently disabled</div>
          <p className="mt-0.5 text-xs">
            Signals are view-only for now — nothing is traded for you and no trading account is created.
          </p>
        </div>
      )}

      {!disabled && settings.tradeReady === false && (
        <div
          className={cn(
            "mb-4 rounded-lg border px-3 py-2.5 text-sm",
            on ? "border-warning/40 bg-warning/10 text-warning" : "border-border bg-surface-2 text-muted",
          )}
        >
          <div className="font-medium">
            {on ? "Copying is on, but your account can't be traded yet" : "Your account isn't ready to be traded yet"}
          </div>
          <p className="mt-0.5 text-xs opacity-90">
            {settings.tradeBlockedReason}
            {on && " Until it clears, signals are skipped rather than traded."}
          </p>
        </div>
      )}

      <Card className="mb-4 p-5">
        <div className="text-sm font-medium">Auto-copy signals</div>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          {direct
            ? "Copy signals straight onto your funded account. Trades are placed for you automatically — there is nothing to install and no broker login to connect."
            : "Copy signals into your own trading platform. Orders are queued for your terminal, which places them through the broker you've already connected — we never see or hold your broker login."}
        </p>

        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {MODES.map((m) => (
            <button
              key={m.value}
              disabled={disabled}
              onClick={() => patch({ mode: m.value })}
              className={cn(
                "rounded-lg border px-3 py-2.5 text-left transition disabled:cursor-not-allowed disabled:opacity-50",
                mode === m.value
                  ? "border-primary bg-primary/10"
                  : "border-border bg-surface-2 hover:bg-surface-3",
              )}
            >
              <div className="text-sm font-medium">{m.label}</div>
              <div className="mt-0.5 text-[11px] leading-snug text-muted">{(direct && m.hintDirect) || m.hint}</div>
            </button>
          ))}
        </div>
      </Card>

      {/* Server URL / ATAS credentials: admin + ATAS pull only. Never show to
        * normal subscribers (especially on the dxFeed prop path). */}
      {disabled ? null : showTerminalSetup ? (
        <ConnectGuide serverUrl={API_BASE} email={email} />
      ) : !direct ? (
        <Card className="mb-4 p-5">
          <div className="text-sm font-medium">Connect your terminal</div>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Terminal connection details are set up by your administrator. You do not need a
            server URL or strategy credentials on this page — turn Automatic or Confirm on above
            once support has finished your setup.
          </p>
        </Card>
      ) : null}

      <Card className={cn("mb-4 p-5 transition", !on && "opacity-50")}>
        <div className="text-sm font-medium">Rules</div>
        <p className="mt-1 text-sm text-muted">Only signals matching all of these are copied.</p>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <NumberField label="Base risk per trade ($)" value={settings.baseRisk ?? 100} min={1} max={100000} disabled={!on}
            onChange={(v) => patch({ baseRisk: v })} />
          <NumberField label="Min. conviction" value={settings.minConviction} min={1} max={4} disabled={!on}
            onChange={(v) => patch({ minConviction: v })} />
          <NumberField label="Max open at once" value={settings.maxConcurrent} min={1} max={50} disabled={!on}
            onChange={(v) => patch({ maxConcurrent: v })} />
          <NumberField label="Max per day" value={settings.maxPerDay} min={1} max={200} disabled={!on}
            onChange={(v) => patch({ maxPerDay: v })} />
        </div>

        <p className="mt-2 text-[11px] text-muted-2">
          Each trade risks your base × the signal&apos;s conviction, sized automatically in micro
          contracts:{" "}
          <span className="text-muted">
            L1 ${settings.baseRisk ?? 100} · L2 ${(settings.baseRisk ?? 100) * 2} · L3 ${(settings.baseRisk ?? 100) * 3} · L4 ${(settings.baseRisk ?? 100) * 4}
          </span>
        </p>

        <div className="mt-4">
          <div className="mb-1.5 text-[11px] text-muted">
            Markets {settings.markets.length === 0 && <span className="text-muted-2">· all</span>}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {MARKETS.map((m) => {
              const active = settings.markets.includes(m);
              return (
                <button
                  key={m}
                  disabled={!on}
                  onClick={() => patch({ markets: active ? settings.markets.filter((x) => x !== m) : [...settings.markets, m] })}
                  className={cn(
                    "rounded-md border px-2.5 py-1 text-xs font-medium transition disabled:cursor-not-allowed",
                    active ? "border-primary bg-primary/15 text-primary" : "border-border bg-surface-2 text-muted hover:text-foreground",
                  )}
                >
                  {m}
                </button>
              );
            })}
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-border px-4 py-3 text-sm font-medium">
          Copy activity <span className="text-muted">({orders.length})</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                <Th>Market</Th><Th>Side</Th><Th className="text-right">Qty</Th>
                <Th>Status</Th><Th>Detail</Th><Th>When</Th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="border-b border-border/60 hover:bg-surface-2">
                  <Td className="font-medium">{o.symbol}</Td>
                  <Td>
                    <span className={cn("font-medium", o.side === "LONG" ? "text-long" : "text-short")}>
                      {o.side === "LONG" ? "Long" : "Short"}
                    </span>
                  </Td>
                  <Td className="nums text-right">{o.quantity}</Td>
                  <Td><Badge tone={STATUS_TONE[o.status] ?? "neutral"}>{STATUS_LABEL[o.status] ?? o.status}</Badge></Td>
                  <Td className="max-w-xs truncate text-muted-2" title={o.reason ?? undefined}>{o.reason ?? "—"}</Td>
                  <Td className="nums text-muted">{timeAgo(o.createdAt)}</Td>
                </tr>
              ))}
              {orders.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-sm text-muted">
                    {disabled
                      ? "Auto-copy is disabled."
                      : on ? "No copied orders yet." : "Automation is off — turn it on to start copying signals."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="mt-3 text-xs text-muted-2">
        Copying follows your subscription access — you can only auto-trade signals you can see.
      </p>
    </div>
  );
}

// One-time setup guide for the terminal that actually places the copied orders.
// Collapsed by default; the connection details are pre-filled from the session.
function ConnectGuide({ serverUrl, email }: { serverUrl: string; email: string }) {
  const [open, setOpen] = useState(false);
  const download = process.env.NEXT_PUBLIC_ATAS_DOWNLOAD_URL;

  return (
    <Card className="mb-4 p-5">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-start justify-between gap-3 text-left">
        <div>
          <div className="text-sm font-medium">Connect your terminal</div>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Automatic and Confirm modes queue orders for a terminal you run (an ATAS strategy). Set it up once
            with the details below — until then, nothing is placed even with a mode selected.
          </p>
        </div>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          className={cn("mt-1 h-4 w-4 shrink-0 text-muted transition", open && "rotate-180")}>
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="mt-4 space-y-4">
          <div className="rounded-lg border border-border bg-surface-2 p-3">
            <div className="mb-1 text-xs font-medium text-muted">Paste these into the ATAS strategy settings</div>
            <CopyRow label="Server URL" value={serverUrl} />
            <CopyRow label="Email" value={email} />
            <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
              <span className="text-muted">Password</span>
              <span className="text-muted-2">your Signal App password (the one you signed in with)</span>
            </div>
          </div>

          <ol className="list-decimal space-y-2 pl-5 text-sm text-muted">
            <li>
              {download
                ? <a href={download} className="font-medium text-primary underline">Download the Signal Copier strategy</a>
                : <span className="text-foreground">Get the Signal Copier strategy file from us</span>}
              , drop it into <code className="rounded bg-surface-3 px-1 py-0.5 text-[11px] text-foreground">%APPDATA%\ATAS\Strategies\</code>, and restart ATAS.
            </li>
            <li>Open a <span className="text-foreground">micro</span> chart (MES, MNQ, MYM, MGC or MCL) on your broker or sim account.</li>
            <li>Add the <span className="text-foreground">Signal Copier</span> strategy to that chart.</li>
            <li>Paste the <span className="text-foreground">Server URL</span> and your <span className="text-foreground">login</span> (above) into its settings.</li>
            <li>Set the mode above to <span className="text-foreground">Automatic</span> or <span className="text-foreground">Confirm each</span>.</li>
            <li>In the strategy, turn <span className="text-foreground">Place orders</span> on once the log looks right. It only trades while ATAS is running.</li>
          </ol>

          <p className="text-[11px] text-muted-2">
            We queue the orders; your terminal places them through your own broker. We never see or hold your broker login.
          </p>
        </div>
      )}
    </Card>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  };
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="shrink-0 text-sm text-muted">{label}</span>
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate font-mono text-xs text-foreground">{value || "—"}</span>
        <button
          onClick={copy}
          disabled={!value}
          className="shrink-0 rounded-md border border-border px-2 py-0.5 text-[11px] text-muted transition hover:text-foreground disabled:opacity-40"
        >
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>
    </div>
  );
}

function NumberField({ label, value, min, max, disabled, onChange }: {
  label: string; value: number; min: number; max: number; disabled?: boolean; onChange: (v: number) => void;
}) {
  // Local draft so typing doesn't fire a save per keystroke; committed on blur.
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);
  const commit = () => {
    const n = Math.min(Math.max(Math.floor(Number(draft)), min), max);
    if (Number.isFinite(n) && n !== value) onChange(n);
    else setDraft(String(value));
  };
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-muted">{label}</span>
      <input
        type="number" inputMode="numeric" min={min} max={max} value={draft} disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
        className="h-9 w-full rounded-lg border border-border bg-surface-2 px-3 text-sm text-foreground focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60"
      />
    </label>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return <th className={cn("px-4 py-2.5 font-medium", className)}>{children}</th>;
}
function Td({ children, className, title }: { children: React.ReactNode; className?: string; title?: string }) {
  return <td className={cn("px-4 py-2.5", className)} title={title}>{children}</td>;
}

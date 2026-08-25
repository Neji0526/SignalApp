"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, MARKETS, type AccessConfig, type AdminUser, type Direction, type ReadinessView, type RiskConfig } from "@/lib/api";
import { getToken } from "@/store/auth-store";
import { useAuthStore } from "@/store/auth-store";
import { Card, Button } from "@/components/ui";
import { cn } from "@/lib/utils";

const CONVICTION_LABEL: Record<number, string> = { 1: "Any", 2: "2+ (medium)", 3: "3+ (high)", 4: "4 only (max)" };

export default function AdminPage() {
  const router = useRouter();
  const role = useAuthStore((s) => s.user?.role);
  const ready = useAuthStore((s) => s.ready);

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminUser | null>(null);

  const refresh = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    try {
      setUsers(await api.adminListUsers(token));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  // Non-admins never see this page.
  useEffect(() => { if (ready && role && role !== "ADMIN") router.replace("/signals"); }, [ready, role, router]);

  if (ready && role && role !== "ADMIN") return null;

  const subscribers = users.filter((u) => u.role !== "ADMIN").length;

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-xl font-semibold">Admin · Users</h1>
        <p className="text-sm text-muted">Manage subscribers and configure the signal access each one receives.</p>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Mini label="Users" value={users.length} />
        <Mini label="Subscribers" value={subscribers} />
        <Mini label="Suspended" value={users.filter((u) => u.status === "SUSPENDED" || u.access.suspended).length} />
      </div>

      {error && <Card className="mb-4 border-short/40 p-3 text-sm text-short">{error}</Card>}

      <RiskConfigCard />

      <ReadinessCard />

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted">
                <Th>User</Th>
                <Th>Role</Th>
                <Th>Access</Th>
                <Th>Status</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-border/60 hover:bg-surface-2">
                  <Td>
                    <div className="font-medium text-foreground">{u.name || "—"}</div>
                    <div className="text-xs text-muted">{u.email}</div>
                  </Td>
                  <Td>
                    <span className={cn("rounded-md px-2 py-0.5 text-xs font-medium", u.role === "ADMIN" ? "bg-primary/15 text-primary" : "bg-surface-3 text-muted")}>
                      {u.role === "ADMIN" ? "Admin" : "Subscriber"}
                    </span>
                  </Td>
                  <Td><AccessSummary access={u.access} /></Td>
                  <Td>
                    <span className={cn("inline-flex items-center gap-1.5 text-xs", u.status === "SUSPENDED" ? "text-short" : "text-long")}>
                      <span className={cn("h-1.5 w-1.5 rounded-full", u.status === "SUSPENDED" ? "bg-short" : "bg-long")} />
                      {u.status === "SUSPENDED" ? "Suspended" : "Active"}
                    </span>
                  </Td>
                  <Td className="text-right">
                    <Button size="sm" variant="secondary" onClick={() => setEditing(u)}>Configure</Button>
                  </Td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-16 text-center text-sm text-muted">{loading ? "Loading…" : "No users yet."}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {editing && (
        <AccessEditor
          user={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void refresh(); }}
        />
      )}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: number }) {
  return (
    <Card className="p-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-0.5 text-xl font-semibold nums">{value}</div>
    </Card>
  );
}

/* dxFeed trade readiness.
 *
 * A subscriber's account can be fully provisioned, report itself enabled, and
 * still silently ignore orders — no rejection, nothing to alert on. So the copy
 * engine refuses to route to an account until a real probe order has been acked,
 * which means an unverified subscriber is having their signals SKIPPED. That is
 * the thing this card exists to surface; it leads with the blocked ones because
 * they are the only rows anyone needs to act on.
 *
 * The backend re-probes every 5 minutes on its own. Re-check is here for when
 * you have just fixed the cause and don't want to wait for the sweep.
 */
function ReadinessCard() {
  const [view, setView] = useState<ReadinessView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    try {
      setView(await api.adminReadiness(token));
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const run = async (userId: string, action: () => Promise<string>) => {
    setBusy(userId); setNote(null);
    try {
      setNote(await action());
      await load();
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const provision = (userId: string) => run(userId, async () => {
    const token = getToken();
    if (!token) return "Not signed in.";
    const link = await api.adminProvisionDxFeed(token, userId);
    return link.dxAccountId
      ? "Account created. It still has to pass a test order before any signals are copied to it."
      : "Partially provisioned — run it again to finish.";
  });

  const recheck = (userId: string) => run(userId, async () => {
    const token = getToken();
    if (!token) return "Not signed in.";
    const r = await api.adminRecheckReadiness(token, userId);
    // Three outcomes, and conflating them is the whole trap: "couldn't tell" is
    // not a failure and says nothing about this subscriber.
    return r.ready ? "Now tradeable."
      : r.inconclusive ? `Couldn't tell — ${r.reason}. Nothing recorded against them; try again once the market is open.`
        : `Still blocked — ${r.reason}`;
  });

  if (err) return <Card className="mb-4 border-short/40 p-3 text-sm text-short">{err}</Card>;
  // On the ATAS pull deployment nobody has a dxFeed account and nobody needs
  // one, so the entire card would be a wall of false alarms.
  if (!view || view.adapter !== "dxfeed" || view.rows.length === 0) return null;

  const rows = view.rows;
  const blocked = rows.filter((r) => !r.tradeVerifiedAt);

  return (
    <Card className="mb-4 p-4">
      <div className="mb-1 flex items-baseline justify-between">
        <div className="text-sm font-medium">Copy trading readiness</div>
        <div className="text-[11px] text-muted-2">
          {blocked.length === 0
            ? `All ${rows.length} subscriber${rows.length === 1 ? "" : "s"} tradeable`
            : `${blocked.length} of ${rows.length} not tradeable`}
        </div>
      </div>
      <p className="mb-3 text-xs text-muted">
        A subscriber is only traded once they have a dxFeed account <em>and</em> a real test order
        has been accepted on it — a provisioned account can look perfectly healthy and still ignore
        orders silently. Until both hold, their signals are skipped. Re-checks run automatically
        every 5 minutes.
      </p>

      {note && <div className="mb-3 rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">{note}</div>}

      {blocked.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-long">
          <span className="h-1.5 w-1.5 rounded-full bg-long" />
          Every subscriber has an account that is accepting orders.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted">
                <Th>Subscriber</Th>
                <Th>Why not tradeable</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {blocked.map((r) => (
                <tr key={r.userId} className="border-b border-border/60">
                  <Td>
                    <div className="font-medium text-foreground">{r.name || "—"}</div>
                    <div className="text-xs text-muted">{r.email}</div>
                  </Td>
                  <Td>
                    <div className="text-xs text-short">
                      {!r.dxAccountId
                        ? "No dxFeed account yet."
                        : r.tradeProbeError || "Not tested yet — the next sweep will try."}
                    </div>
                  </Td>
                  <Td className="text-right">
                    {r.dxAccountId ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy === r.userId}
                        onClick={() => void recheck(r.userId)}
                      >
                        {busy === r.userId ? "Checking…" : "Re-check"}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy === r.userId}
                        onClick={() => void provision(r.userId)}
                      >
                        {busy === r.userId ? "Creating…" : "Provision"}
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// Global DEFAULT base risk per trade. A signal's risk = base × its conviction
// (1..4); copied trades are sized (in micro contracts) to hit that dollar figure —
// so a higher-conviction signal carries proportionally more size. Each subscriber
// can override this base on their own automation page; this is the fallback.
function RiskConfigCard() {
  const [cfg, setCfg] = useState<RiskConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    api.adminGetRiskConfig(token).then(setCfg).catch((e) => setErr((e as Error).message));
  }, []);

  const setBase = (v: number) =>
    setCfg((c) => (c ? { ...c, baseRisk: Math.max(1, Math.floor(v || 1)) } : c));

  const save = async () => {
    const token = getToken();
    if (!token || !cfg) return;
    setSaving(true); setErr(null); setSaved(false);
    try {
      setCfg(await api.adminSetRiskConfig(token, cfg));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const base = cfg?.baseRisk ?? 100;
  return (
    <Card className="mb-4 p-4">
      <div className="mb-1 flex items-baseline justify-between">
        <div className="text-sm font-medium">Default base risk per trade</div>
        <div className="text-[11px] text-muted-2">Copied trades are sized in micros to risk this much</div>
      </div>
      <p className="mb-3 text-xs text-muted">
        A trade risks the base × the signal&apos;s conviction (1–4); the copier switches to micro
        contracts and places the quantity that risks that amount, using the signal&apos;s stop
        distance. Subscribers can override this base on their own account.
      </p>
      {!cfg ? (
        <div className="py-4 text-sm text-muted">Loading…</div>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-xs text-muted">Base risk</span>
            <div className="flex items-center rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 focus-within:border-primary">
              <span className="text-sm text-muted-2">$</span>
              <input
                type="number"
                min={1}
                value={cfg.baseRisk}
                onChange={(e) => setBase(Number(e.target.value))}
                className="w-24 bg-transparent px-1 text-right text-sm font-medium outline-none nums"
              />
            </div>
          </label>
          <div className="pb-1.5 text-xs text-muted-2">
            L1 <span className="text-muted">${base}</span> · L2 <span className="text-muted">${base * 2}</span> ·
            L3 <span className="text-muted">${base * 3}</span> · L4 <span className="text-muted">${base * 4}</span>
          </div>
          <Button onClick={save} loading={saving}>Save</Button>
          {saved && <span className="text-xs text-long">Saved ✓</span>}
          {err && <span className="text-xs text-short">{err}</span>}
        </div>
      )}
    </Card>
  );
}

function AccessSummary({ access }: { access: AccessConfig }) {
  if (access.suspended) return <span className="rounded-md bg-short/15 px-2 py-0.5 text-xs font-medium text-short">Feed off</span>;
  const chips: string[] = [];
  chips.push(access.markets.length ? access.markets.join(" · ") : "All markets");
  chips.push(access.direction === "BOTH" ? "Long & Short" : access.direction === "LONG" ? "Long only" : "Short only");
  chips.push(access.dailyLimit == null ? "Unlimited" : `${access.dailyLimit}/day`);
  if (access.minConviction > 1) chips.push(`Conv ${access.minConviction}+`);
  if (access.allocationPercent < 100) chips.push(`Copies ${access.allocationPercent}%`);
  if (access.maxCopiesPerDay != null) chips.push(`≤${access.maxCopiesPerDay} copies/day`);
  if (!access.live) chips.push("History only");
  return (
    <div className="flex flex-wrap gap-1">
      {chips.map((c, i) => (
        <span key={i} className="rounded-md bg-surface-3 px-1.5 py-0.5 text-[11px] text-muted">{c}</span>
      ))}
    </div>
  );
}

// --- Access editor modal ---------------------------------------------------

function AccessEditor({ user, onClose, onSaved }: { user: AdminUser; onClose: () => void; onSaved: () => void }) {
  const [access, setAccess] = useState<AccessConfig>(user.access);
  const [status, setStatus] = useState<"ACTIVE" | "SUSPENDED">(user.status);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const patch = (p: Partial<AccessConfig>) => setAccess((a) => ({ ...a, ...p }));
  const toggleMarket = (m: string) =>
    setAccess((a) => ({ ...a, markets: a.markets.includes(m) ? a.markets.filter((x) => x !== m) : [...a.markets, m] }));

  const save = async () => {
    const token = getToken();
    if (!token) return;
    setSaving(true); setErr(null);
    try {
      await api.adminUpdateUser(token, user.id, { access, status });
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-[var(--radius-card)] border border-border bg-surface shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-border px-5 py-4">
          <div>
            <div className="text-sm font-semibold text-foreground">Configure access</div>
            <div className="text-xs text-muted">{user.name ? `${user.name} · ` : ""}{user.email}</div>
          </div>
          <button onClick={onClose} className="text-muted hover:text-foreground">✕</button>
        </div>

        <div className="space-y-5 px-5 py-4">
          {/* Markets */}
          <Section title="Markets" hint={access.markets.length ? undefined : "None selected = all markets"}>
            <div className="flex flex-wrap gap-2">
              {MARKETS.map((m) => (
                <Chip key={m} active={access.markets.includes(m)} onClick={() => toggleMarket(m)}>{m}</Chip>
              ))}
              {access.markets.length > 0 && (
                <button onClick={() => patch({ markets: [] })} className="text-xs text-muted underline hover:text-foreground">clear (= all)</button>
              )}
            </div>
          </Section>

          {/* Direction */}
          <Section title="Direction">
            <Segmented<Direction>
              value={access.direction}
              options={[{ v: "BOTH", label: "Both" }, { v: "LONG", label: "Long only" }, { v: "SHORT", label: "Short only" }]}
              onChange={(v) => patch({ direction: v })}
            />
          </Section>

          {/* Daily limit */}
          <Section title="Signals per day" hint="Extra signals appear locked to the subscriber.">
            <div className="flex items-center gap-3">
              <Chip active={access.dailyLimit == null} onClick={() => patch({ dailyLimit: null })}>Unlimited</Chip>
              <input
                type="number"
                min={0}
                value={access.dailyLimit ?? ""}
                placeholder="e.g. 5"
                onChange={(e) => patch({ dailyLimit: e.target.value === "" ? null : Math.max(0, Math.floor(Number(e.target.value))) })}
                className="w-28 rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-sm outline-none focus:border-primary"
              />
              <span className="text-xs text-muted">per day</span>
            </div>
          </Section>

          {/* Conviction floor */}
          <Section title="Conviction floor" hint="Only deliver signals at or above this conviction.">
            <select
              value={access.minConviction}
              onChange={(e) => patch({ minConviction: Number(e.target.value) })}
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-primary"
            >
              {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{CONVICTION_LABEL[n]}</option>)}
            </select>
          </Section>

          {/* Copy allocation */}
          <Section
            title="Copy allocation"
            hint="Share of eligible signals actually copied. Different % → different accounts get different trades."
          >
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={access.allocationPercent}
                onChange={(e) => patch({ allocationPercent: Number(e.target.value) })}
                className="flex-1 accent-primary"
              />
              <div className="flex items-center rounded-lg border border-border bg-surface-2 px-2.5 py-1.5">
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={access.allocationPercent}
                  onChange={(e) => patch({ allocationPercent: Math.min(100, Math.max(0, Math.floor(Number(e.target.value) || 0))) })}
                  className="w-12 bg-transparent text-right text-sm font-medium outline-none nums"
                />
                <span className="text-sm text-muted-2">%</span>
              </div>
            </div>
            <p className="text-[11px] text-muted-2">
              100% = copies every eligible signal (default). Lower spreads the fleet across different
              trades — the subscriber still <span className="text-muted">sees</span> all of them.
            </p>
          </Section>

          {/* Max copied trades per day (admin hard cap) */}
          <Section
            title="Copied trades per day"
            hint="Hard cap on trades actually placed (rolling 24h). Overrides the subscriber's own limit."
          >
            <div className="flex items-center gap-3">
              <Chip active={access.maxCopiesPerDay == null} onClick={() => patch({ maxCopiesPerDay: null })}>Unlimited</Chip>
              <input
                type="number"
                min={0}
                value={access.maxCopiesPerDay ?? ""}
                placeholder="e.g. 1"
                onChange={(e) => patch({ maxCopiesPerDay: e.target.value === "" ? null : Math.max(0, Math.floor(Number(e.target.value))) })}
                className="w-28 rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-sm outline-none focus:border-primary"
              />
              <span className="text-xs text-muted">per day</span>
            </div>
            <p className="text-[11px] text-muted-2">
              Caps how many trades are <span className="text-muted">placed</span> for this account,
              no matter how many signals they see or set on their own page.
            </p>
          </Section>

          {/* Toggles */}
          <Section title="Live access">
            <ToggleRow
              label="Deliver live (active) signals"
              hint="Off = the subscriber sees only the closed track record."
              on={access.live}
              onChange={(v) => patch({ live: v })}
            />
            <ToggleRow
              label="Suspend signal feed"
              hint="Cuts all signals without deleting the account."
              on={access.suspended}
              danger
              onChange={(v) => patch({ suspended: v })}
            />
            <ToggleRow
              label="Suspend login"
              hint="Blocks the subscriber from signing in entirely."
              on={status === "SUSPENDED"}
              danger
              onChange={(v) => setStatus(v ? "SUSPENDED" : "ACTIVE")}
            />
          </Section>

          {err && <div className="text-sm text-short">{err}</div>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} loading={saving}>Save access</Button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-sm font-medium text-foreground">{title}</span>
        {hint && <span className="text-[11px] text-muted-2">{hint}</span>}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-lg border px-3 py-1.5 text-sm font-medium transition",
        active ? "border-primary bg-primary/15 text-primary" : "border-border bg-surface-2 text-muted hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          className={cn("rounded-md px-3 py-1.5 text-sm font-medium transition", value === o.v ? "bg-primary text-white" : "text-muted hover:text-foreground")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ToggleRow({ label, hint, on, onChange, danger }: { label: string; hint?: string; on: boolean; onChange: (v: boolean) => void; danger?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2">
      <div>
        <div className="text-sm text-foreground">{label}</div>
        {hint && <div className="text-[11px] text-muted-2">{hint}</div>}
      </div>
      <button
        onClick={() => onChange(!on)}
        className={cn("relative h-5 w-9 shrink-0 rounded-full transition", on ? (danger ? "bg-short" : "bg-primary") : "bg-surface-3")}
        aria-pressed={on}
      >
        <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all", on ? "left-[18px]" : "left-0.5")} />
      </button>
    </div>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return <th className={cn("px-4 py-2.5 font-medium", className)}>{children}</th>;
}
function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={cn("px-4 py-3", className)}>{children}</td>;
}

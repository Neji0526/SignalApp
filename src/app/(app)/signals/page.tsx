"use client";

import { useEffect, useMemo, useState } from "react";
import { useSignalsStore } from "@/store/signals-store";
import { Card, Stat, Badge } from "@/components/ui";
import { ConvictionBadge } from "@/components/ConvictionBadge";
import { type Signal } from "@/lib/api";
import { cn, timeAgo } from "@/lib/utils";

/* The Signals page MIRRORS the TradingApp admin "Positions" page: same columns,
   same live cadence — but every row is the counter side of the trader's position
   (side flipped, SL/TP swapped, P&L negated). Trader identity is deliberately NOT
   carried across: subscribers see the trade, never who took it.
   Unlike the admin page, open and closed signals share ONE table (open first), so
   the column set is the union of both: Exit is blank while open, Target/Stop keep
   showing where the levels were after close, and Result is unrealized-vs-final
   depending on status. */

const price = (n: number) => parseFloat(n.toFixed(2)).toString();
const money = (n: number) =>
  `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const signed = (n: number) => `${n >= 0 ? "+" : "-"}$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const pnlClass = (n: number) => (n > 0 ? "text-long" : n < 0 ? "text-short" : "text-muted");

const dt = (ms: number) =>
  new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export default function SignalsPage() {
  const { signals, loading, live, load, connect, disconnect } = useSignalsStore();
  const [query, setQuery] = useState("");

  useEffect(() => {
    void load();
    connect();
    return () => disconnect();
  }, [load, connect, disconnect]);

  const active = useMemo(
    () => signals.filter((s) => s.status === "active").sort((a, b) => b.openedAt - a.openedAt),
    [signals],
  );
  const closed = useMemo(
    () => signals.filter((s) => s.status === "closed").sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0)),
    [signals],
  );

  const q = query.trim().toLowerCase();
  const matches = (s: Signal) =>
    !q || `${s.symbol} ${s.market} ${s.side} ${sourceLabel(s)}`.toLowerCase().includes(q);
  // One list, open signals on top — each half already sorted newest-first.
  const rows = [...active, ...closed].filter(matches);

  const openUnrealized = active.reduce((a, s) => a + (s.unrealizedPnl ?? 0), 0);
  const closedRealized = closed.reduce((a, s) => a + (s.pnl ?? 0), 0);

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Signals</h1>
          <p className="text-sm text-muted">Every open and closed signal, live.</p>
        </div>
        <div className={cn("flex shrink-0 items-center gap-1.5 text-sm", live ? "text-long" : "text-muted")}>
          <span className={cn("h-2 w-2 rounded-full", live ? "bg-long animate-pulse" : "bg-muted-2")} />
          {live ? "Live" : "Reconnecting…"}
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Open signals" value={active.length} />
        <Stat label="Open P&L" value={money(openUnrealized)} tone={openUnrealized >= 0 ? "long" : "short"} />
        <Stat label="Closed signals" value={closed.length} />
        <Stat label="Closed P&L" value={money(closedRealized)} tone={closedRealized >= 0 ? "long" : "short"} />
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="text-sm font-medium">
            Trades <span className="text-muted">({signals.length})</span>
          </div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by market, side, platform…"
            className="h-9 w-full max-w-xs rounded-lg border border-border bg-surface-2 px-3 text-sm text-foreground placeholder:text-muted-2 focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                <Th>Market</Th>
                <Th>Side</Th>
                <Th className="text-center">Conviction</Th>
                <Th className="text-right">Qty</Th>
                <Th className="text-right">Entry</Th>
                <Th className="text-right">Target</Th>
                <Th className="text-right">Stop</Th>
                <Th className="text-right">Exit</Th>
                <Th className="text-right">Result</Th>
                <Th>Status</Th>
                <Th>Time</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => <Row key={s.id} s={s} />)}
              {rows.length === 0 && (
                <EmptyRow span={11}>
                  {loading ? "Loading…" : signals.length === 0 ? "No signals yet." : "No matching signals."}
                </EmptyRow>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="mt-3 text-xs text-muted-2">
        Open P&L is marked to the live market; closed P&L is final.
      </p>
    </div>
  );
}

function SideBadge({ side }: { side: string }) {
  return <Badge tone={side === "LONG" ? "long" : "short"}>{side}</Badge>;
}

const sourceLabel = (s: Signal) => (s.source === "deepchart" ? "Deepchart" : "Vault");

/** Where the trader placed the trade — the Vault web platform or Deepchart. */
function SourceTag({ s }: { s: Signal }) {
  return (
    <Badge tone={s.source === "deepchart" ? "info" : "neutral"} className="ml-2 px-1.5 text-[10px]">
      {sourceLabel(s)}
    </Badge>
  );
}

/** Over the daily limit: tease the row, hide every tradeable level behind a lock. */
const LOCK = <span className="select-none blur-[3px]">•••••</span>;

function LockedRow({ s }: { s: Signal }) {
  return (
    <tr className="border-b border-border/60 text-muted hover:bg-surface-2">
      <Td className="font-medium text-muted">{s.symbol}<SourceTag s={s} /></Td>
      <Td><SideBadge side={s.side} /></Td>
      <Td className="text-center"><ConvictionBadge level={s.conviction} /></Td>
      {/* Qty, Entry, Target, Stop, Exit, Result — every tradeable number stays hidden. */}
      {Array.from({ length: 6 }).map((_, i) => (
        <Td key={i} className="nums text-right text-muted-2">{LOCK}</Td>
      ))}
      <Td><StatusBadge s={s} /></Td>
      <Td>
        <span className="inline-flex items-center gap-1 rounded-md bg-warning/15 px-1.5 py-0.5 text-[11px] font-medium text-warning">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          Upgrade
        </span>
      </Td>
    </tr>
  );
}

function StatusBadge({ s }: { s: Signal }) {
  return s.status === "active" ? (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-long">
      <span className="h-1.5 w-1.5 rounded-full bg-long animate-pulse" />
      Open
    </span>
  ) : (
    <span className="text-xs text-muted-2">Closed</span>
  );
}

function Row({ s }: { s: Signal }) {
  if (s.locked) return <LockedRow s={s} />;

  const isOpen = s.status === "active";
  // Open rows mark to market; closed rows show the final number. `null` means the
  // live mark is unavailable — show "—", never a fabricated $0.
  const pnl = isOpen ? s.unrealizedPnl : s.pnl;
  // Time tracks the event that last moved the row: opened while open, closed once closed.
  const when = isOpen ? s.openedAt : (s.closedAt ?? s.openedAt);

  return (
    <tr
      className={cn(
        "border-b border-border/60 hover:bg-surface-2",
        isOpen ? (s.side === "LONG" ? "bg-long/5" : "bg-short/5") : "text-muted",
      )}
    >
      <Td className={cn("font-medium whitespace-nowrap", !isOpen && "text-foreground")}>{s.symbol}<SourceTag s={s} /></Td>
      <Td><SideBadge side={s.side} /></Td>
      <Td className="text-center"><ConvictionBadge level={s.conviction} /></Td>
      <Td className="nums text-right">{s.quantity}</Td>
      <Td className={cn("nums text-right", isOpen && "font-medium")}>{price(s.entry)}</Td>
      <Td className="nums text-right">
        {s.takeProfit != null ? <span className="text-long">{price(s.takeProfit)}</span> : <span className="text-muted-2">—</span>}
      </Td>
      <Td className="nums text-right">
        {s.stopLoss != null ? <span className="text-short">{price(s.stopLoss)}</span> : <span className="text-muted-2">—</span>}
      </Td>
      <Td className="nums text-right">
        {s.exit != null ? price(s.exit) : <span className="text-muted-2">—</span>}
      </Td>
      <Td className={cn("nums text-right font-medium", pnl != null && pnlClass(pnl))}>
        {pnl != null ? signed(pnl) : <span className="text-muted-2" title="Waiting for a live market price">—</span>}
      </Td>
      <Td><StatusBadge s={s} /></Td>
      <Td className="nums text-muted"><span title={dt(when)}>{timeAgo(when)}</span></Td>
    </tr>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return <th className={cn("px-4 py-2.5 font-medium", className)}>{children}</th>;
}
function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={cn("px-4 py-2.5", className)}>{children}</td>;
}
function EmptyRow({ span, children }: { span: number; children: React.ReactNode }) {
  return (
    <tr><td colSpan={span} className="px-4 py-12 text-center text-sm text-muted">{children}</td></tr>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuthStore } from "@/store/auth-store";
import { ThemeToggle } from "@/components/ThemeToggle";
import { cn } from "@/lib/utils";
import { useAutoCopyEnabled } from "@/lib/features";

const NAV = [
  { href: "/signals", label: "Signals" },
  { href: "/performance", label: "Performance" },
  { href: "/automation", label: "Automation" },
];
// Admin-only pages. Chart is an internal tool subscribers don't need, so it lives
// here next to Admin rather than in the shared nav.
const ADMIN_NAV = [
  { href: "/chart", label: "Chart" },
  { href: "/admin", label: "Admin" },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const role = useAuthStore((s) => s.user?.role);
  const autoCopy = useAutoCopyEnabled();
  const nav = role === "ADMIN" ? [...NAV, ...ADMIN_NAV] : NAV;
  const offTag = (href: string) =>
    href === "/automation" && autoCopy === false
      ? <span className="ml-1.5 rounded bg-surface-3 px-1.5 py-0.5 text-[10px] font-medium text-muted-2">Off</span>
      : null;

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="hidden w-56 shrink-0 flex-col border-r border-border bg-surface p-4 md:flex">
        <div className="mb-6 flex items-center gap-2 px-2">
          <span className="text-lg font-semibold text-foreground">◆ Signals</span>
        </div>
        <nav className="flex flex-col gap-1">
          {nav.map((n) => {
            const active = pathname.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={cn(
                  "rounded-lg px-3 py-2 text-sm font-medium transition",
                  active ? "bg-primary/15 text-primary" : "text-muted hover:bg-surface-2 hover:text-foreground",
                )}
              >
                {n.label}
                {offTag(n.href)}
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-border bg-surface px-4 py-3 md:px-6">
          <div className="flex items-center gap-3 md:hidden">
            <span className="font-semibold">◆ Signals</span>
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <UserMenu />
          </div>
        </header>
        {/* Mobile nav */}
        <nav className="flex gap-1 overflow-x-auto border-b border-border bg-surface px-3 py-2 md:hidden">
          {nav.map((n) => {
            const active = pathname.startsWith(n.href);
            return (
              <Link key={n.href} href={n.href} className={cn("whitespace-nowrap rounded-lg px-3 py-1.5 text-sm", active ? "bg-primary/15 text-primary" : "text-muted")}>
                {n.label}
                {offTag(n.href)}
              </Link>
            );
          })}
        </nav>
        <main className="mx-auto w-full max-w-6xl flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}

function UserMenu() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const label = user?.name || user?.email || "Account";
  const initial = (user?.name || user?.email || "?").charAt(0).toUpperCase();

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 py-1.5 pl-1.5 pr-2 text-sm hover:bg-surface-3"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/20 text-xs font-semibold text-primary">{initial}</span>
        <span className="hidden max-w-[160px] truncate text-muted sm:inline">{label}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted-2"><path d="M6 9l6 6 6-6" /></svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-56 overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
          <div className="border-b border-border px-3 py-2.5">
            <div className="truncate text-sm font-medium text-foreground">{user?.name || "Subscriber"}</div>
            <div className="truncate text-xs text-muted">{user?.email}</div>
          </div>
          <button
            onClick={() => { setOpen(false); logout(); }}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-foreground hover:bg-surface-2"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-short">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" />
            </svg>
            Log out
          </button>
        </div>
      )}
    </div>
  );
}

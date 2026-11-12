"use client";

/**
 * The signed-in header's tabs: the current page is marked (aria-current and an underline), and
 * Requests and Meetings carry counts. Requests counts new requests waiting for an answer. Meetings
 * counts booked meetings that haven't ended. Counts refresh on every page change and each minute;
 * a failed read just hides them.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { RequestView } from "@/contracts/types";
import { ACTIVITY_EVENT } from "./toast";

const TABS = [
  { href: "/ask", label: "Ask", match: ["/ask", "/matches"] },
  { href: "/find", label: "Find", match: ["/find"] },
  { href: "/inbox", label: "Requests", match: ["/inbox"] },
  { href: "/meetings", label: "Meetings", match: ["/meetings"] },
  { href: "/onboarding/profile", label: "Profile", match: ["/onboarding"] },
] as const;

type Counts = { requests: number; meetings: number };

async function readCounts(): Promise<Counts | null> {
  try {
    const [inbox, sent] = await Promise.all(["/api/inbox", "/api/requests/sent"].map((u) => fetch(u, { cache: "no-store" })));
    if (!inbox.ok || !sent.ok) return null;
    const incoming = (await inbox.json()) as RequestView[];
    const outgoing = (await sent.json()) as RequestView[];
    const now = Date.now();
    const upcoming = (r: RequestView) => r.status === "scheduled" && r.slot !== null && Date.parse(r.slot.end) > now;
    return {
      requests: incoming.filter((r) => r.status === "sent").length,
      meetings: incoming.filter(upcoming).length + outgoing.filter(upcoming).length,
    };
  } catch {
    return null;
  }
}

export function AppNav() {
  const pathname = usePathname();
  const [counts, setCounts] = useState<Counts | null>(null);

  useEffect(() => {
    let live = true;
    const refresh = () => void readCounts().then((c) => live && setCounts(c));
    refresh();
    const timer = setInterval(refresh, 60_000);
    window.addEventListener(ACTIVITY_EVENT, refresh);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener(ACTIVITY_EVENT, refresh);
    };
  }, [pathname]);

  return (
    <>
      {TABS.map((tab) => {
        const current = tab.match.some((m) => pathname === m || pathname.startsWith(`${m}/`));
        const count = tab.label === "Requests" ? counts?.requests : tab.label === "Meetings" ? counts?.meetings : undefined;
        const what = tab.label === "Requests" ? "new" : "upcoming";
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={current ? "page" : undefined}
            className="relative flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-[15px] font-semibold text-muted hover:bg-surface hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent aria-[current=page]:text-foreground sm:px-3 sm:text-base"
          >
            {tab.label}
            {count ? (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-xs font-bold text-on-accent">
                {count}
                <span className="sr-only"> {what}</span>
              </span>
            ) : null}
            {current && <span aria-hidden="true" className="absolute inset-x-2 -bottom-[7px] h-[3px] rounded-full bg-accent sm:inset-x-3" />}
          </Link>
        );
      })}
    </>
  );
}

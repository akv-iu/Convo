"use client";

/**
 * A heads-up at the top of Requests when one of your booked meetings starts within 15 minutes:
 * who with, how soon, and a link to Meetings. Reads both sides (requests you accepted, and ones
 * you sent); a failed read shows nothing.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { startsIn, useMinuteClock } from "@/components/ui/meeting-booked";
import type { RequestView } from "@/contracts/types";

const SOON_MS = 15 * 60_000;

export function MeetingSoon() {
  const [meetings, setMeetings] = useState<RequestView[]>([]);
  const now = useMinuteClock();

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const lists = await Promise.all(["/api/inbox", "/api/requests/sent"].map((u) => fetch(u, { cache: "no-store" })));
        if (lists.some((r) => !r.ok)) return;
        const all = (await Promise.all(lists.map((r) => r.json()))).flat() as RequestView[];
        if (live) setMeetings(all.filter((r) => r.status === "scheduled" && r.slot));
      } catch {
        // No heads-up; Meetings still lists them.
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  if (now === null) return null;
  const next = meetings
    .filter((m) => m.slot && Date.parse(m.slot.end) > now && Date.parse(m.slot.start) - now <= SOON_MS)
    .sort((a, b) => a.slot!.start.localeCompare(b.slot!.start))[0];
  if (!next?.slot) return null;
  return (
    <div role="status" className="mx-auto mb-6 flex max-w-2xl flex-wrap items-center justify-between gap-3 rounded-2xl bg-success px-5 py-4 text-on-success">
      <p className="font-bold">
        {startsIn(next.slot.start, next.slot.end, now)}: your meeting with {next.person?.name ?? "someone"}
      </p>
      <Link href="/meetings" className="font-semibold underline underline-offset-4">
        See your meetings
      </Link>
    </div>
  );
}

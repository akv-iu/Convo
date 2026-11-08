"use client";

/**
 * Meetings: every booked meeting in one list, soonest first, from both sides: requests you
 * accepted (GET /api/inbox) and requests you sent that were booked (GET /api/requests/sent).
 * Each shows when, who, the question, their shared contact details and Add to calendar.
 */
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { MeetingBooked } from "@/components/ui/meeting-booked";
import { PersonBadge } from "@/components/ui/person-badge";
import { SharedContactCard } from "@/components/ui/shared-contact";
import type { RequestView } from "@/contracts/types";
import { venueRange } from "../inbox/inbox";

type Meeting = RequestView & { slot: NonNullable<RequestView["slot"]>; mine: boolean };
type Load = { state: "loading" } | { state: "failed" } | { state: "ready"; meetings: Meeting[] };

export function MeetingsView() {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const [inbox, sent] = await Promise.all(["/api/inbox", "/api/requests/sent"].map((u) => fetch(u)));
        if (!inbox.ok || !sent.ok) throw new Error("load failed");
        const booked = (list: RequestView[], mine: boolean) =>
          list.flatMap((r) => (r.status === "scheduled" && r.slot ? [{ ...r, slot: r.slot, mine }] : []));
        const meetings = [...booked(await inbox.json(), false), ...booked(await sent.json(), true)].sort((a, b) =>
          a.slot.start.localeCompare(b.slot.start),
        );
        if (live) setLoad({ state: "ready", meetings });
      } catch {
        if (live) setLoad({ state: "failed" });
      }
    })();
    return () => {
      live = false;
    };
  }, [attempt]);

  return (
    <section aria-labelledby="meetings-heading" className="mt-2">
      <h1 id="meetings-heading" className="text-[2.6rem] font-extrabold leading-[1.02] tracking-[-0.03em] [font-stretch:85%] sm:text-5xl">
        Meetings
      </h1>
      <p className="mt-3 text-lg text-muted">Your booked meetings, soonest first.</p>

      <div className="mt-6">
        {load.state === "loading" && <p role="status">Loading your meetings…</p>}
        {load.state === "failed" && (
          <div>
            <p role="alert" className="text-lg">
              Your meetings didn&apos;t load.
            </p>
            <div className="mt-4">
              <Button onClick={() => (setLoad({ state: "loading" }), setAttempt((n) => n + 1))}>Try again</Button>
            </div>
          </div>
        )}
        {load.state === "ready" && load.meetings.length === 0 && (
          <div className="rounded-2xl border-2 border-border bg-surface p-6">
            <h2 className="text-2xl font-extrabold tracking-tight">No meetings booked yet</h2>
            <p className="mt-2 text-muted">When you and someone agree on a time, the meeting shows up here.</p>
            <div className="mt-5">
              <Button href="/inbox" variant="secondary">
                Go to your requests
              </Button>
            </div>
          </div>
        )}
        {load.state === "ready" && load.meetings.length > 0 && (
          <ul className="flex flex-col gap-4">
            {load.meetings.map((m) => (
              <li key={m.id}>
                <article aria-labelledby={`meeting-${m.id}`} className="rounded-2xl border-2 border-border bg-surface p-5">
                  <MeetingBooked when={venueRange(m.slot)} className="" />
                  <div className="mt-3">
                    <PersonBadge person={m.person} caption={m.mine ? "With (you asked)" : "With (they asked)"} />
                  </div>
                  <h2 id={`meeting-${m.id}`} className="mt-3 text-lg font-semibold leading-snug break-words">
                    {m.question}
                  </h2>
                  {m.contact && <SharedContactCard contact={m.contact} name={m.person?.name ?? "them"} />}
                </article>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

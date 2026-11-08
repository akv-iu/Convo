"use client";

/**
 * "You asked": the asker's side of every request (GET /api/requests/sent),
 * organised by question. Each question is a row that opens to show everyone
 * it went to: their badge, whether they accepted or declined, their short
 * reply, and the booked meeting time.
 * Once accepted, either person can pick the time, so the slot picker shows
 * here too. Nothing is retried automatically; a failure offers a reload.
 */
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Request, RequestView } from "@/contracts/types";
import { lengthLabel } from "../ask/asks";
import { groupByQuestion, groupSummary, inboxFailure, sentStatusLabel, venueRange, venueTime, type AskGroup, type Failure } from "./inbox";
import { PersonBadge } from "@/components/ui/person-badge";
import { SlotPicker } from "./slot-picker";

type Load = { state: "loading" } | { state: "ready"; requests: RequestView[] } | { state: "failed"; failure: Failure };

export function SentRequests() {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [announce, setAnnounce] = useState("");
  /** The questions opened to show their people; all start closed. */
  const [openAsks, setOpenAsks] = useState<ReadonlySet<string>>(() => new Set());
  const groups = useMemo(() => (load.state === "ready" ? groupByQuestion(load.requests) : []), [load]);

  function toggle(askId: string) {
    setOpenAsks((cur) => {
      const next = new Set(cur);
      if (next.has(askId)) next.delete(askId);
      else next.add(askId);
      return next;
    });
  }

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const res = await fetch("/api/requests/sent", { cache: "no-store" });
        if (!live) return;
        if (!res.ok) return setLoad({ state: "failed", failure: inboxFailure(res.status) });
        const requests = (await res.json()) as RequestView[];
        if (live) setLoad({ state: "ready", requests });
      } catch {
        if (live) setLoad({ state: "failed", failure: inboxFailure(0) });
      }
    })();
    return () => {
      live = false;
    };
  }, [attempt]);

  function reload() {
    setLoad({ state: "loading" });
    setAttempt((n) => n + 1);
  }

  function booked(updated: Request) {
    setAnnounce(updated.slot ? `Meeting booked: ${venueRange(updated.slot)}` : "Meeting booked.");
    // A booking returns a plain request: keep the receiver's badge and the ask type already shown.
    setLoad((cur) =>
      cur.state === "ready"
        ? { state: "ready", requests: cur.requests.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)) }
        : cur,
    );
  }

  return (
    <section aria-labelledby="sent-heading" className="mx-auto mt-12 flex w-full max-w-2xl flex-col">
      <h2 id="sent-heading" className="text-2xl font-extrabold tracking-tight">
        You asked
      </h2>
      <p className="mt-1 text-muted">What happened to the questions you sent.</p>
      <output aria-live="polite" className="sr-only">
        {announce}
      </output>

      <div className="mt-5">
        {load.state === "loading" && (
          <output aria-busy="true" className="block text-muted">
            Loading what you asked…
          </output>
        )}

        {load.state === "failed" && (
          <div>
            <p role="alert">{load.failure.message}</p>
            <div className="mt-3">
              {load.failure.action ? (
                <Button href={load.failure.action.href}>{load.failure.action.label}</Button>
              ) : (
                <Button onClick={reload}>Try again</Button>
              )}
            </div>
          </div>
        )}

        {load.state === "ready" && load.requests.length === 0 && (
          <p className="text-muted">
            You haven&apos;t sent anyone a question yet.{" "}
            <a href="/ask" className="font-semibold text-accent underline-offset-4 hover:underline">
              Ask one
            </a>
          </p>
        )}

        {load.state === "ready" && groups.length > 0 && (
          <ul className="flex flex-col gap-3">
            {groups.map((g) => (
              <li key={g.askId}>
                <QuestionGroup group={g} open={openAsks.has(g.askId)} onToggle={() => toggle(g.askId)} onBooked={booked} onReload={reload} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/** One question: a row with what was asked and where things stand, opening to the people it went to. */
function QuestionGroup({
  group,
  open,
  onToggle,
  onBooked,
  onReload,
}: {
  group: AskGroup;
  open: boolean;
  onToggle: () => void;
  onBooked: (r: Request) => void;
  onReload: () => void;
}) {
  const panelId = `asked-${group.askId}-people`;
  return (
    <section
      aria-labelledby={`asked-${group.askId}-q`}
      className={`overflow-hidden rounded-2xl border-2 bg-surface ${open ? "border-accent" : "border-border"}`}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
        className="flex w-full items-start gap-3 px-5 py-4 text-left hover:bg-accent/5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
      >
        <span className="min-w-0 flex-1">
          <span id={`asked-${group.askId}-q`} className="block text-lg font-semibold leading-snug tracking-tight break-words">
            {group.question}
          </span>
          <span className="mt-1 flex flex-wrap gap-x-2 text-sm text-muted">
            <span>{lengthLabel(group.minutes)}</span>
            <span>· {venueTime(group.latest)}</span>
          </span>
          <span className="mt-1 block text-sm font-semibold">{groupSummary(group.requests)}</span>
        </span>
        <span
          aria-hidden="true"
          className={`flex size-10 shrink-0 items-center justify-center rounded-full border-2 ${
            open ? "border-accent bg-accent text-on-accent" : "border-border bg-background text-foreground"
          }`}
        >
          <svg viewBox="0 0 24 24" className={`size-6 ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </span>
      </button>
      {open && (
        <ul id={panelId} className="flex flex-col gap-3 border-t-2 border-border px-4 pb-4 pt-4">
          {group.requests.map((r) => (
            <li key={r.id}>
              <SentCard request={r} onBooked={onBooked} onReload={onReload} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** One person a question went to: their badge and what happened. The question itself is on the group's row. */
function SentCard({ request, onBooked, onReload }: { request: RequestView; onBooked: (r: Request) => void; onReload: () => void }) {
  const qId = `sent-${request.id}-q`;
  const name = request.person?.name;
  const who = name ?? "They";
  return (
    <article aria-labelledby={qId} className="rounded-xl border-2 border-border bg-background p-4">
      <h3 id={qId} className="sr-only">
        Sent to {name ?? "someone at the conference"}
      </h3>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span
          className={`rounded-full px-3 py-0.5 font-semibold ${request.status === "sent" ? "bg-[var(--skeleton)]" : "bg-accent text-on-accent"}`}
        >
          {sentStatusLabel[request.status]}
        </span>
        <span className="text-muted">{venueTime(request.createdAt)}</span>
      </div>

      <div className="mt-3">
        <PersonBadge person={request.person} caption="Sent to" />
      </div>

      {request.status === "sent" && <p className="mt-2 text-sm text-muted">Waiting for {name ?? "them"} to answer.</p>}
      {request.status === "declined" && <p className="mt-2 text-muted">{who} declined this one.</p>}
      {request.status === "answered" && request.reply && (
        <p className="mt-3 rounded-xl bg-accent/10 px-4 py-3">
          <span className="block text-xs font-semibold text-muted">{who} replied</span>
          {request.reply}
        </p>
      )}
      {request.status === "scheduled" && request.slot && (
        <p className="mt-3 rounded-xl bg-accent/10 px-4 py-3 font-semibold">Meeting booked: {venueRange(request.slot)}</p>
      )}
      {request.status === "accepted" && !request.slot && <SlotPicker request={request} onBooked={onBooked} onReload={onReload} />}
    </article>
  );
}

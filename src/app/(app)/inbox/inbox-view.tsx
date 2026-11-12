"use client";

/**
 * A2 step 4: the receiver's inbox. Each request shows the question up
 * front, the meeting length and when it arrived, with Accept, Decline or a
 * short reply instead of meeting (POST /api/requests/:id/respond).
 *
 * One answer is saved at a time per request, nothing is retried
 * automatically (a failed write may have committed), and a failure offers
 * a reload so the user sees what was actually saved.
 *
 * A2 step 5: an accepted request without a time shows the slot picker.
 */
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ScanRadar } from "@/components/ui/scan-radar";
import { SharedContactCard } from "@/components/ui/shared-contact";
import type { Request, RequestView } from "@/contracts/types";
import { lengthLabel } from "../ask/asks";
import { PersonBadge } from "@/components/ui/person-badge";
import { SlotPicker } from "./slot-picker";
import {
  inboxFailure,
  inboxOrder,
  REPLY_MAX,
  replyProblem,
  respondFailure,
  statusLabel,
  venueRange,
  venueTime,
  type Failure,
} from "./inbox";

const headingClass =
  "text-[2.2rem] font-extrabold leading-[1.02] tracking-[-0.03em] [font-stretch:85%] sm:text-5xl";
const errorClass = "text-sm font-medium text-[var(--danger)]";

type Load = { state: "loading" } | { state: "ready"; requests: RequestView[] } | { state: "failed"; failure: Failure };
type Action = { action: "accept" } | { action: "decline" } | { action: "reply"; reply: string };

export function InboxView() {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [announce, setAnnounce] = useState("");

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const res = await fetch("/api/inbox", { cache: "no-store" });
        if (!live) return;
        if (!res.ok) return setLoad({ state: "failed", failure: inboxFailure(res.status) });
        const requests = (await res.json()) as RequestView[];
        if (live) setLoad({ state: "ready", requests: inboxOrder(requests) });
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

  function saved(updated: Request, message: string) {
    setAnnounce(message);
    // Answers and bookings return a plain request: keep the asker's badge and the ask type already shown.
    setLoad((cur) =>
      cur.state === "ready"
        ? { state: "ready", requests: cur.requests.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)) }
        : cur,
    );
    // Agreeing shares contact details both ways: fetch the asker's, which the plain request doesn't carry.
    if (updated.status === "accepted" || updated.status === "scheduled") void loadContact(updated.id);
  }

  async function loadContact(id: string) {
    try {
      const res = await fetch("/api/inbox");
      if (!res.ok) return;
      const fresh = ((await res.json()) as RequestView[]).find((r) => r.id === id);
      if (!fresh?.contact) return;
      setLoad((cur) =>
        cur.state === "ready"
          ? { state: "ready", requests: cur.requests.map((r) => (r.id === id ? { ...r, contact: fresh.contact } : r)) }
          : cur,
      );
    } catch {
      // The details show on the next visit; nothing else depends on them.
    }
  }

  const pending = load.state === "ready" ? load.requests.filter((r) => r.status === "sent").length : 0;

  return (
    <div className="mx-auto flex max-w-2xl flex-col">
      <h1 className={headingClass}>Requests</h1>
      <p className="mt-3 text-lg text-muted">
        {load.state === "ready" && pending > 0
          ? `${pending} ${pending === 1 ? "person wants" : "people want"} to ask you something.`
          : "Questions people here want to ask you."}
      </p>

      <p role="status" aria-live="polite" className="sr-only">
        {announce}
      </p>

      <div className="mt-8">
        {load.state === "loading" && (
          <p role="status" aria-busy="true" className="text-muted">
            Loading your requests…
          </p>
        )}

        {load.state === "failed" && (
          <div>
            <p role="alert" className="text-lg">
              {load.failure.message}
            </p>
            <div className="mt-4">
              {load.failure.action ? (
                <Button href={load.failure.action.href}>{load.failure.action.label}</Button>
              ) : (
                <Button onClick={reload}>Try again</Button>
              )}
            </div>
          </div>
        )}

        {load.state === "ready" && load.requests.length === 0 && (
          <div className="flex flex-col items-center rounded-2xl border-2 border-border bg-surface p-6 text-center sm:flex-row sm:gap-8 sm:text-left">
            <ScanRadar className="w-32 shrink-0 sm:w-36" />
            <div className="mt-5 sm:mt-0">
            <h2 className="text-2xl font-extrabold tracking-tight">No requests yet</h2>
            <p className="mt-2 text-muted">Lanyard is looking for people your skills can help. When someone sends you their question, it shows up here.</p>
            <div className="mt-5">
              <Button href="/ask" variant="secondary">
                Ask your own question
              </Button>
            </div>
            </div>
          </div>
        )}

        {load.state === "ready" && load.requests.length > 0 && (
          <ul className="flex flex-col gap-4">
            {load.requests.map((r) => (
              <li key={r.id}>
                <RequestCard request={r} onSaved={saved} onReload={reload} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function RequestCard({
  request,
  onSaved,
  onReload,
}: {
  request: RequestView;
  onSaved: (r: Request, message: string) => void;
  onReload: () => void;
}) {
  const [busy, setBusy] = useState<Action["action"] | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState("");
  const [tried, setTried] = useState(false);
  const replyRef = useRef<HTMLTextAreaElement>(null);
  const qId = `req-${request.id}-q`;
  const problem = tried ? replyProblem(reply) : null;

  async function respond(body: Action) {
    if (busy) return;
    setBusy(body.action);
    setFailure(null);
    try {
      const res = await fetch(`/api/requests/${encodeURIComponent(request.id)}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setFailure(respondFailure(res.status, json));
        return;
      }
      setReplying(false);
      onSaved(
        json as Request,
        body.action === "accept" ? "Accepted." : body.action === "decline" ? "Declined." : "Reply sent.",
      );
    } catch {
      setFailure(respondFailure(0, null));
    } finally {
      setBusy(null);
    }
  }

  function sendReply() {
    setTried(true);
    if (replyProblem(reply)) {
      replyRef.current?.focus();
      return;
    }
    void respond({ action: "reply", reply: reply.trim() });
  }

  return (
    <article aria-labelledby={qId} className="rounded-2xl border-2 border-border bg-surface p-5">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span
          className={`rounded-full px-3 py-0.5 font-semibold ${request.status === "sent" ? "bg-accent text-on-accent" : "bg-[var(--skeleton)]"}`}
        >
          {statusLabel[request.status]}
        </span>
        <span className="text-muted">{lengthLabel(request.minutes)}</span>
        <span className="text-muted">· {venueTime(request.createdAt)}</span>
      </div>

      <div className="mt-3">
        <PersonBadge person={request.person} caption="Asked by" />
      </div>

      <h2 id={qId} className="mt-3 text-xl font-semibold leading-snug tracking-tight break-words">
        {request.question}
      </h2>
      {request.message && (
        <p className="mt-3 rounded-xl border-2 border-border px-4 py-3 break-words">
          <span className="block text-xs font-semibold text-muted">Their message</span>
          {request.message}
        </p>
      )}

      {request.status === "answered" && request.reply && (
        <p className="mt-3 rounded-xl bg-accent/10 px-4 py-3">
          <span className="block text-xs font-semibold text-muted">You replied</span>
          {request.reply}
        </p>
      )}
      {request.status === "scheduled" && request.slot && (
        <p className="mt-3 rounded-xl bg-accent/10 px-4 py-3 font-semibold">Meeting booked: {venueRange(request.slot)}</p>
      )}
      {request.status === "declined" && <p className="mt-3 text-muted">You declined this one.</p>}
      {(request.status === "accepted" || request.status === "scheduled") && request.contact && (
        <SharedContactCard contact={request.contact} name={request.person?.name ?? "them"} />
      )}
      {request.status === "accepted" && !request.slot && (
        <SlotPicker request={request} onBooked={(r) => onSaved(r, `Meeting booked: ${r.slot ? venueRange(r.slot) : ""}`)} onReload={onReload} />
      )}

      {request.status === "sent" && !replying && (
        <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Button onClick={() => void respond({ action: "accept" })} disabled={busy !== null}>
            {busy === "accept" ? "Accepting…" : "Accept"}
            <span className="sr-only"> this request</span>
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setReplying(true);
              setTimeout(() => replyRef.current?.focus(), 0);
            }}
            disabled={busy !== null}
          >
            Reply instead
          </Button>
          <Button variant="secondary" onClick={() => void respond({ action: "decline" })} disabled={busy !== null}>
            {busy === "decline" ? "Declining…" : "Decline"}
            <span className="sr-only"> this request</span>
          </Button>
          <p className="text-sm text-muted sm:col-span-3">
            Accepting shares the contact details you chose with {request.person?.name ?? "them"}, and theirs with you.{" "}
            <a href="/onboarding/profile" className="font-semibold text-accent underline-offset-4 hover:underline">
              Change what you share
            </a>
          </p>
        </div>
      )}

      {request.status === "sent" && replying && (
        <div className="mt-5 flex flex-col gap-2">
          <label htmlFor={`${qId}-reply`} className="font-semibold">
            Your reply
          </label>
          <textarea
            id={`${qId}-reply`}
            ref={replyRef}
            value={reply}
            rows={3}
            maxLength={REPLY_MAX + 50}
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? `${qId}-reply-problem` : undefined}
            onChange={(e) => setReply(e.target.value)}
            className="w-full rounded-xl border-2 border-border bg-background px-4 py-3 leading-snug focus-visible:border-accent focus-visible:outline-none aria-invalid:border-[var(--danger-border)]"
          />
          {problem && (
            <p id={`${qId}-reply-problem`} className={errorClass}>
              {problem}
            </p>
          )}
          <div className="flex gap-2">
            <Button onClick={sendReply} disabled={busy !== null}>
              {busy === "reply" ? "Sending…" : "Send reply"}
            </Button>
            <Button variant="secondary" onClick={() => setReplying(false)} disabled={busy !== null}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {failure && (
        <p role="alert" className={`mt-3 ${errorClass}`}>
          {failure.message}{" "}
          {failure.action ? (
            <a href={failure.action.href} className="underline underline-offset-4">
              {failure.action.label}
            </a>
          ) : (
            <button type="button" onClick={onReload} className="underline underline-offset-4">
              Reload requests
            </button>
          )}
        </p>
      )}
    </article>
  );
}

"use client";

/**
 * A2 step 5: after accepting, pick when to meet. GET
 * /api/requests/:id/slots suggests up to three times when both people are
 * free (never sooner than an hour away); choosing one books it with POST
 * /api/requests/:id/schedule.
 *
 * Per db/Scheduling.md: a 409 means the time was just taken or went stale,
 * so fresh suggestions load; a 503 may have saved the booking, so the user
 * reloads the inbox to check instead of booking again. Nothing is retried
 * automatically.
 */
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Request, Slot } from "@/contracts/types";
import { bookFailure, slotsFailure, venueRange, type Failure } from "./inbox";

type Load = { state: "loading" } | { state: "ready"; slots: Slot[] } | { state: "failed"; failure: Failure };

export function SlotPicker({
  request,
  onBooked,
  onReload,
}: {
  request: Request;
  onBooked: (r: Request) => void;
  onReload: () => void;
}) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [booking, setBooking] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const res = await fetch(`/api/requests/${encodeURIComponent(request.id)}/slots`, { cache: "no-store" });
        const body = await res.json().catch(() => null);
        if (!live) return;
        if (!res.ok) return setLoad({ state: "failed", failure: slotsFailure(res.status, body) });
        setLoad({ state: "ready", slots: body as Slot[] });
      } catch {
        if (live) setLoad({ state: "failed", failure: slotsFailure(0, null) });
      }
    })();
    return () => {
      live = false;
    };
  }, [request.id, attempt]);

  function refreshSlots() {
    setLoad({ state: "loading" });
    setAttempt((n) => n + 1);
  }

  async function book(slot: Slot) {
    if (booking) return;
    setBooking(slot.start);
    setFailure(null);
    try {
      const res = await fetch(`/api/requests/${encodeURIComponent(request.id)}/schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slot }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const f = bookFailure(res.status, body);
        setFailure(f);
        if (res.status === 409) refreshSlots(); // taken or stale: show fresh times
        return;
      }
      onBooked(body as Request);
    } catch {
      setFailure(bookFailure(0, null));
    } finally {
      setBooking(null);
    }
  }

  const headingId = `req-${request.id}-slots`;

  return (
    <section aria-labelledby={headingId} className="mt-4 rounded-xl border-2 border-border bg-background p-4">
      <h3 id={headingId} className="font-semibold">
        Pick a time to meet
      </h3>

      {load.state === "loading" && (
        <p role="status" aria-busy="true" className="mt-2 text-sm text-muted">
          Finding times you&apos;re both free…
        </p>
      )}

      {load.state === "failed" && (
        <p role="alert" className="mt-2 text-sm">
          {load.failure.message}{" "}
          {load.failure.action ? (
            <a href={load.failure.action.href} className="font-semibold underline underline-offset-4">
              {load.failure.action.label}
            </a>
          ) : (
            <button type="button" onClick={refreshSlots} className="font-semibold underline underline-offset-4">
              Try again
            </button>
          )}
        </p>
      )}

      {load.state === "ready" && load.slots.length === 0 && (
        <p className="mt-2 text-sm">
          No shared free time in the hours ahead.{" "}
          <a href="/onboarding/free-time" className="font-semibold underline underline-offset-4">
            Add more free times
          </a>{" "}
          or reply with a short answer instead.
        </p>
      )}

      {load.state === "ready" && load.slots.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2">
          {load.slots.map((slot) => (
            <li key={slot.start}>
              <Button
                variant="secondary"
                onClick={() => void book(slot)}
                disabled={booking !== null}
                className="w-full justify-between! text-left"
              >
                <span>{venueRange(slot)}</span>
                <span className="text-sm font-semibold text-accent">{booking === slot.start ? "Booking…" : "Book"}</span>
              </Button>
            </li>
          ))}
        </ul>
      )}

      {failure && (
        <p role="alert" className="mt-3 text-sm font-medium text-[var(--danger)]">
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
    </section>
  );
}

"use client";

/**
 * A1 step 6: "N people are looking for someone like you", from
 * GET /api/looking-for-me (distinct other people with an open ask this
 * user could answer). It loads once when the screen opens. A failed load
 * says so with Try again (or Sign in again when the session has expired);
 * it's never shown as zero.
 *
 * The banner is one polite live region that stays on the page, so screen
 * readers hear the count, or the failure, after a load or a retry; focus
 * moves to it on Try again instead of being lost with the button.
 */
import { useEffect, useRef, useState } from "react";
import { lookingLabel } from "./asks";

type State = { state: "loading" } | { state: "ready"; count: number } | { state: "failed"; status: number };

export function LookingForYou() {
  const [load, setLoad] = useState<State>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const regionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const res = await fetch("/api/looking-for-me", { cache: "no-store" });
        const body = res.ok ? ((await res.json()) as { count: number }) : null;
        if (!live) return;
        setLoad(
          body && Number.isInteger(body.count) ? { state: "ready", count: body.count } : { state: "failed", status: res.status },
        );
      } catch {
        if (live) setLoad({ state: "failed", status: 0 });
      }
    })();
    return () => {
      live = false;
    };
  }, [attempt]);

  function retry() {
    setLoad({ state: "loading" });
    setAttempt((n) => n + 1);
    regionRef.current?.focus(); // the button is about to go; keep the user's place
  }

  const expired = load.state === "failed" && (load.status === 401 || load.status === 404);

  return (
    <div
      ref={regionRef}
      tabIndex={-1}
      role="status"
      aria-live="polite"
      aria-busy={load.state === "loading"}
      className="mx-auto mb-8 flex max-w-2xl items-center gap-4 rounded-2xl border-2 border-border bg-surface px-5 py-4 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      {load.state === "loading" && (
        <>
          <span className="h-10 w-12 rounded-lg bg-[var(--skeleton)] motion-safe:animate-pulse" aria-hidden="true" />
          <span className="sr-only">Loading who&apos;s looking for you…</span>
          <span className="h-3 flex-1 rounded-full bg-[var(--skeleton)] motion-safe:animate-pulse" aria-hidden="true" />
        </>
      )}

      {load.state === "failed" && (
        <>
          <p className="flex-1 text-sm text-muted">
            {expired ? "Your sign-in has expired." : "Couldn't load who's looking for you."}
          </p>
          {expired ? (
            <a
              href="/signin"
              className="flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Sign in again
            </a>
          ) : (
            <button
              type="button"
              onClick={retry}
              className="min-h-11 rounded-lg px-3 text-sm font-semibold text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Try again
            </button>
          )}
        </>
      )}

      {load.state === "ready" && (
        <p data-testid="looking-for-you" className="flex items-center gap-4">
          <span className="text-4xl font-extrabold leading-none tracking-tight [font-stretch:85%] text-accent">
            {lookingLabel(load.count).number}
          </span>{" "}
          <span className="text-base font-semibold leading-snug">{lookingLabel(load.count).text}</span>
        </p>
      )}
    </div>
  );
}

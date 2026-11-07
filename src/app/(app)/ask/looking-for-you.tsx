"use client";

/**
 * A1 step 6: "N people are looking for someone like you", from
 * GET /api/looking-for-me (distinct other people with an open ask this
 * user could answer). It loads once when the screen opens. A failed load
 * says so with Try again; it's never shown as zero.
 */
import { useEffect, useState } from "react";
import { lookingLabel } from "./asks";

type State = { state: "loading" } | { state: "ready"; count: number } | { state: "failed" };

export function LookingForYou() {
  const [load, setLoad] = useState<State>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const res = await fetch("/api/looking-for-me", { cache: "no-store" });
        const body = res.ok ? ((await res.json()) as { count: number }) : null;
        if (!live) return;
        setLoad(body && Number.isInteger(body.count) ? { state: "ready", count: body.count } : { state: "failed" });
      } catch {
        if (live) setLoad({ state: "failed" });
      }
    })();
    return () => {
      live = false;
    };
  }, [attempt]);

  const box = "mx-auto mb-8 flex max-w-2xl items-center gap-4 rounded-2xl border-2 border-border bg-surface px-5 py-4";

  if (load.state === "loading") {
    return (
      <div className={box} aria-busy="true">
        <span className="h-10 w-12 rounded-lg bg-[var(--skeleton)] motion-safe:animate-pulse" />
        <span className="sr-only">Loading who&apos;s looking for you…</span>
        <span className="h-3 flex-1 rounded-full bg-[var(--skeleton)] motion-safe:animate-pulse" aria-hidden="true" />
      </div>
    );
  }

  if (load.state === "failed") {
    return (
      <div className={box}>
        <p className="flex-1 text-sm text-muted">Couldn&apos;t load who&apos;s looking for you.</p>
        <button
          type="button"
          onClick={() => {
            setLoad({ state: "loading" });
            setAttempt((n) => n + 1);
          }}
          className="min-h-11 rounded-lg px-3 text-sm font-semibold text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Try again
        </button>
      </div>
    );
  }

  const { number, text } = lookingLabel(load.count);
  return (
    <p className={box} data-testid="looking-for-you">
      <span className="text-4xl font-extrabold leading-none tracking-tight [font-stretch:85%] text-accent">
        {number}
      </span>{" "}
      <span className="text-base font-semibold leading-snug">{text}</span>
    </p>
  );
}

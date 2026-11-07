"use client";

/**
 * Step 3: tap the half-hour blocks you're free for on the conference
 * day. Loads GET /api/availability and saves with PUT /api/availability,
 * which replaces the whole list (B2's handoff, db/Profile-API.md and
 * db/Scheduling.md); neighbouring blocks are sent as one interval.
 *
 * Not shown against the talk schedule yet: there is no schedule data in
 * the contract or fixtures. See the PR notes.
 */
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Person, TimeBlock } from "@/contracts/types";
import { Badge, BadgeChip } from "../../_components/badge";
import { showSavedColour } from "../../_components/badge-prefs";
import { countryName } from "@/components/ui/countries";
import { loadProblem } from "../profile/edits";
import {
  availabilityBody,
  blocksForDay,
  blocksIn,
  clock,
  hiddenFromGrid,
  hourLabel,
  pickedFromSaved,
  presets,
  runLabels,
  runs,
  sameSet,
  timeLabel,
  totalLabel,
  VENUE_LABEL,
} from "./blocks";

export const NEXT_STEP = "/onboarding/profile";

const blocks = blocksForDay();
const hours = Array.from(new Set(blocks.map((b) => Math.floor(b.from / 60))));

const headingClass =
  "text-[2.6rem] font-extrabold leading-[1.02] tracking-[-0.03em] [font-stretch:85%] sm:text-6xl";
const errorClass = "text-sm font-medium text-[var(--danger)]";

type Load = { state: "loading" } | { state: "failed"; status: number } | { state: "ready" };

function saveProblem(status: number, body: unknown): string {
  const server =
    typeof body === "object" && body && "error" in body && typeof body.error === "string" ? body.error : null;
  if (status === 401 || status === 404) return "Your sign-in has expired. Sign in again to save your free times.";
  if (status === 400) return "Those times weren't accepted. Check them and try again.";
  if (status === 503) return server ?? "Saving failed for a moment. Try again.";
  return "Your free times weren't saved. Try again.";
}

export function FreeTimeForm() {
  const router = useRouter();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [original, setOriginal] = useState<Set<number>>(new Set());
  /** Saved times the grid can't show; sent back with every save so they're never deleted. */
  const [hidden, setHidden] = useState<TimeBlock[]>([]);
  /**
   * After a failed save the next Continue always saves, even with no changes:
   * a 503 can leave the profile saved but missing from search (and so from
   * everyone's matches) until a save succeeds.
   */
  const [mustResend, setMustResend] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [who, setWho] = useState<{ name: string; handle: Person["githubLogin"]; country: string } | null>(null);

  // The badge shows the real name when the profile loads; it's not needed for this step, so failures are ignored.
  useEffect(() => {
    let live = true;
    fetch("/api/me", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<Person>) : null))
      .then((p) => {
        if (!live || !p) return;
        showSavedColour(p.badgeColour); // the saved colour wins over this browser's preview cookie
        setWho({ name: p.name, handle: p.githubLogin, country: p.filters.country });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const res = await fetch("/api/availability", { cache: "no-store" });
        if (!live) return;
        if (!res.ok) return setLoad({ state: "failed", status: res.status });
        const times = (await res.json()) as TimeBlock[];
        if (!live) return;
        const saved = pickedFromSaved(blocks, times);
        setHidden(hiddenFromGrid(blocks, times));
        setPicked(saved);
        setOriginal(new Set(saved));
        setLoad({ state: "ready" });
      } catch {
        if (live) setLoad({ state: "failed", status: 0 });
      }
    })();
    return () => {
      live = false;
    };
  }, [attempt]);

  function toggle(i: number) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  function togglePreset(indexes: number[]) {
    setPicked((prev) => {
      const next = new Set(prev);
      const allOn = indexes.every((i) => next.has(i));
      indexes.forEach((i) => (allOn ? next.delete(i) : next.add(i)));
      return next;
    });
  }

  async function finish() {
    setSaveError(null);
    setSaving(true);
    try {
      if (mustResend || !sameSet(picked, original)) {
        const res = await fetch("/api/availability", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(availabilityBody(blocks, picked, hidden)),
        });
        if (!res.ok) {
          setMustResend(true);
          setSaveError(saveProblem(res.status, await res.json().catch(() => null)));
          return;
        }
        setMustResend(false);
      }
      router.push(NEXT_STEP);
    } catch {
      setMustResend(true);
      setSaveError(saveProblem(0, null));
    } finally {
      setSaving(false);
    }
  }

  if (load.state === "loading") {
    return (
      <div aria-busy="true">
        <h1 className={headingClass}>When are you free?</h1>
        <p role="status" className="mt-3 text-lg text-muted">
          Loading your free times…
        </p>
      </div>
    );
  }

  if (load.state === "failed") {
    const expired = load.status === 401 || load.status === 404;
    const problem = expired
      ? loadProblem(load.status)
      : { message: "Your free times didn't load. Try again in a moment.", action: null };
    return (
      <div className="max-w-md">
        <h1 className={headingClass}>When are you free?</h1>
        <p role="alert" className="mt-4 text-lg">
          {problem.message}
        </p>
        <div className="mt-6">
          {problem.action ? (
            <Button href={problem.action.href}>{problem.action.label}</Button>
          ) : (
            <Button onClick={() => (setLoad({ state: "loading" }), setAttempt((n) => n + 1))}>Try again</Button>
          )}
        </div>
      </div>
    );
  }

  const labels = runLabels(blocks, picked);
  const badge = (
    <Badge name={who?.name} handle={who?.handle} label={who ? countryName(who.country) : undefined}>
      <span className="mt-4 block">
        <span className="block text-xs text-muted">Free to meet</span>
        <span className="flex flex-wrap gap-1.5 pt-1.5">
          {picked.size ? (
            runs(blocks, picked).map((r) => (
              <BadgeChip key={r.from} className="bg-accent/20">
                {clock(r.from)}–{clock(r.to)}
              </BadgeChip>
            ))
          ) : (
            <span className="text-sm text-muted">Not set yet</span>
          )}
        </span>
      </span>
    </Badge>
  );

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:gap-16">
      <div className="flex flex-col">
        <h1 className={headingClass}>When are you free?</h1>
        <p className="mt-3 max-w-md text-lg text-muted">
          Tap the times you could meet on Monday 9 November. People can only book you then.
        </p>

        <div className="mt-8" role="group" aria-label="Quick picks">
          <div className="flex flex-wrap gap-2">
            {presets.map((p) => {
              const indexes = blocksIn(blocks, p.from, p.to);
              const on = indexes.every((i) => picked.has(i));
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={on}
                  aria-label={`${p.label}, ${timeLabel(p.from)} to ${timeLabel(p.to)}`}
                  onClick={() => togglePreset(indexes)}
                  className="group min-h-11 rounded-full border-2 border-border bg-surface px-4 font-semibold transition-colors aria-pressed:border-accent aria-pressed:bg-accent aria-pressed:text-on-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none"
                >
                  <span aria-hidden="true" className="hidden group-aria-pressed:inline">
                    ✓{" "}
                  </span>
                  {p.label}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setPicked(new Set())}
              disabled={picked.size === 0}
              className="min-h-11 rounded-full px-4 font-semibold text-accent underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:text-muted disabled:no-underline"
            >
              Clear
            </button>
          </div>
        </div>

        <div className="mt-6" role="group" aria-labelledby="free-times-label">
          <p id="free-times-label" className="mb-3 text-sm text-muted">
            {VENUE_LABEL}, half-hour blocks
          </p>
          <ol className="flex flex-col gap-2" role="list">
            {hours.map((h) => (
              <li key={h} className="grid grid-cols-[3.5rem_1fr_1fr] items-center gap-2">
                <span aria-hidden="true" className="text-sm font-semibold text-muted">
                  {hourLabel(h * 60)}
                </span>
                {blocks.map((b, i) =>
                  Math.floor(b.from / 60) === h ? (
                    <button
                      key={b.start}
                      type="button"
                      aria-pressed={picked.has(i)}
                      aria-label={`${timeLabel(b.from)} to ${timeLabel(b.to)}`}
                      onClick={() => toggle(i)}
                      // Free: solid accent with a tick and a ring. Not free: a faint dashed outline, so the picks stand out.
                      className="group inline-flex min-h-12 items-center justify-center gap-1 rounded-xl border-2 border-dashed border-border bg-transparent font-medium text-muted tabular-nums transition-colors hover:border-accent hover:text-foreground aria-pressed:border-solid aria-pressed:border-accent aria-pressed:bg-accent aria-pressed:font-extrabold aria-pressed:text-on-accent aria-pressed:shadow-[0_0_0_3px_var(--accent)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent motion-reduce:transition-none"
                    >
                      <span aria-hidden="true" className="hidden group-aria-pressed:inline">
                        ✓
                      </span>
                      {clock(b.from)}
                    </button>
                  ) : null,
                )}
              </li>
            ))}
          </ol>
        </div>

        <div role="status" aria-live="polite" className="mt-6">
          <p className="font-semibold">{totalLabel(picked)}</p>
          {labels.length ? (
            <p className="text-sm text-muted">{labels.join(", ")}</p>
          ) : (
            <p className="text-sm text-muted">People can&apos;t book a time with you until you add some.</p>
          )}
        </div>
        {hidden.length > 0 && (
          <p className="mt-2 text-sm text-muted">
            You also have {hidden.length === 1 ? "1 saved time" : `${hidden.length} saved times`} this grid can&apos;t
            show. They stay as they are.
          </p>
        )}

        <div className="mt-8 lg:hidden">{badge}</div>

        <div className="sticky bottom-0 -mx-4 mt-8 bg-background/95 px-4 pb-4 pt-3 backdrop-blur sm:static sm:mx-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
          {saveError && (
            <p role="alert" className={`mb-3 ${errorClass}`}>
              {saveError}
              {saveError.startsWith("Your sign-in has expired") && (
                <>
                  {" "}
                  <a href="/signin" className="underline underline-offset-4">
                    Sign in again
                  </a>
                </>
              )}
            </p>
          )}
          <Button onClick={finish} disabled={saving} className="w-full text-lg sm:w-auto sm:px-8">
            {saving ? "Saving…" : "Continue"}
          </Button>
        </div>
      </div>

      <div className="hidden lg:block">
        <div className="lg:sticky lg:top-6">{badge}</div>
      </div>
    </div>
  );
}

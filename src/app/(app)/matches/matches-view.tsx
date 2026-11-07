"use client";

/**
 * A2 steps 1 and 2: the people Convo found for an ask, one card at a time.
 * Swipe right (or press "Send request", or →) to send them the question;
 * swipe left (or "Pass", or ←) to pass. A search box narrows the list.
 *
 * Saves follow db/Rejections.md and db/Requests.md: one at a time, never
 * retried automatically, and a failed pass is checked by refreshing the
 * matches (the server leaves out whoever was saved as passed). After three
 * passes the server may hide everyone ranked below them; the deck follows
 * the returned cutoff.
 *
 * A2 step 3: the soft-blocker switch (PUT /api/soft-blocker). On, people
 * passed on for this ask stay hidden here (and, on the real backend, this
 * user is hidden from them); off brings them back. The batch cutoff stays
 * either way. Changing it reloads the matches.
 */
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent } from "react";
import { Button } from "@/components/ui/button";
import type { MatchResult } from "@/contracts/types";
import { recallAsk } from "../ask/asks";
import { MatchCard } from "./match-card";
import {
  blockerFailure,
  matchFailure,
  passFailure,
  recallBlocker,
  rememberBlocker,
  sendFailure,
  swipeOutcome,
  withinCutoff,
  type Failure,
  type Swipe,
} from "./matches";

const headingClass =
  "text-[2.2rem] font-extrabold leading-[1.02] tracking-[-0.03em] [font-stretch:85%] sm:text-5xl";
const errorClass = "text-sm font-medium text-[var(--danger)]";

type Load =
  | { state: "loading" }
  | { state: "ready"; matches: MatchResult[] }
  | { state: "failed"; failure: Failure };

export function MatchesView() {
  const askId = useSearchParams().get("ask") ?? "";
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState<"pass" | "send" | null>(null);
  const [actionFailure, setActionFailure] = useState<Failure | null>(null);
  /**
   * Set after a failed pass: the server may have saved it, and every pass
   * counts (three hide the rest), so both actions stay off on this card
   * until Refresh matches shows what was saved.
   */
  const [passLocked, setPassLocked] = useState(false);
  /** The save in flight, as a ref: state only updates after a re-render, too late to stop a second press. */
  const busyRef = useRef(false);
  const [announce, setAnnounce] = useState("");
  const [sent, setSent] = useState<string[]>([]);
  const [cutoffNote, setCutoffNote] = useState(false);
  const [dx, setDx] = useState(0);
  const drag = useRef<{ x: number; id: number } | null>(null);
  /** Bumped whenever the deck reloads, so a pass or send answered after a reload can't move the new deck. */
  const deckGen = useRef(0);
  const [question, setQuestion] = useState<string | null>(null);
  /** null: not saved from this tab, so the screen can't know (there's no route to read it back yet). */
  const [blocker, setBlocker] = useState<boolean | null>(null);
  const blockerRef = useRef<boolean | null>(null);
  useEffect(() => {
    blockerRef.current = blocker;
  }, [blocker]);
  const [blockerSaving, setBlockerSaving] = useState(false);
  const [blockerFailed, setBlockerFailed] = useState<Failure | null>(null);

  useEffect(() => {
    if (!askId) return;
    deckGen.current++;
    let live = true;
    void (async () => {
      try {
        const res = await fetch("/api/match", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(applied ? { askId, query: applied } : { askId }),
        });
        const body = await res.json().catch(() => null);
        if (!live) return;
        // The question and switch come from this tab's copies (there's no route to read an ask back).
        setQuestion(recallAsk(askId)?.refined.text ?? null);
        setBlocker(recallBlocker(askId));
        if (!res.ok) return setLoad({ state: "failed", failure: matchFailure(res.status, body) });
        setLoad({ state: "ready", matches: [...(body as MatchResult[])].sort((a, b) => a.rank - b.rank) });
        setIndex(0);
        setPassLocked(false);
      } catch {
        if (live) setLoad({ state: "failed", failure: matchFailure(0, null) });
      }
    })();
    return () => {
      live = false;
    };
  }, [askId, applied, attempt]);

  const matches = useMemo(() => (load.state === "ready" ? load.matches : []), [load]);
  const current = matches[index] ?? null;

  function refresh() {
    setActionFailure(null);
    setLoad({ state: "loading" });
    setAttempt((n) => n + 1);
  }

  const act = useCallback(
    async (kind: "pass" | "send") => {
      if (!current || busyRef.current || passLocked || blockerSaving) return;
      busyRef.current = true;
      setBusy(kind);
      setActionFailure(null);
      setDx(0); // the card goes back at once instead of waiting off to the side for the save
      const who = current.person.name;
      const gen = deckGen.current;
      try {
        const res =
          kind === "pass"
            ? await fetch("/api/rejections", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ askId, personId: current.person.id, rank: current.rank }),
              })
            : await fetch("/api/requests", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ askId, toPersonId: current.person.id }),
              });
        const body = await res.json().catch(() => null);
        // If the deck reloaded meanwhile (Search, Refresh or the switch), only the deck stays as it is:
        // the result, a failure, and who was sent the ask still count.
        const stale = deckGen.current !== gen;
        if (!res.ok) {
          const failure = kind === "pass" ? passFailure(res.status, body) : sendFailure(res.status, body);
          if (stale) {
            // The card on screen is from the new deck: say who this was for, and leave that card usable.
            setActionFailure({ ...failure, message: `${who}: ${failure.message}` });
          } else {
            setActionFailure(failure);
            if (kind === "pass") setPassLocked(true);
          }
          return;
        }
        if (stale) {
          if (kind === "send") {
            setSent((s) => [...s, who]);
          } else {
            // The reload may have been answered before this pass was saved: apply it to the new deck too.
            const cutoff = (body as { hiddenBelowRank: number | null }).hiddenBelowRank;
            const passedId = current.person.id;
            setLoad((cur) => {
              if (cur.state !== "ready") return cur;
              const left = blockerRef.current === false ? cur.matches : cur.matches.filter((m) => m.person.id !== passedId);
              return { state: "ready", matches: withinCutoff(left, cutoff) };
            });
          }
          setAnnounce(kind === "send" ? `Request sent to ${who}.` : `Passed on ${who}.`);
          return;
        }
        if (kind === "send") {
          setSent((s) => [...s, who]);
          setAnnounce(`Request sent to ${who}.`);
          setIndex((i) => i + 1);
        } else {
          const cutoff = (body as { hiddenBelowRank: number | null }).hiddenBelowRank;
          setAnnounce(`Passed on ${who}.`);
          if (cutoff !== null) {
            // The cutoff is the highest rank passed on (db/Rejections.md): only ranks below it stay,
            // which are usually cards already seen, so the deck often ends here. Say why.
            const kept = withinCutoff(matches, cutoff);
            if (kept.length < matches.length) setCutoffNote(true);
            setLoad({ state: "ready", matches: kept });
            setIndex((i) => Math.min(i + 1, kept.length));
          } else {
            setIndex((i) => i + 1);
          }
        }
      } catch {
        const failure = kind === "pass" ? passFailure(0, null) : sendFailure(0, null);
        if (deckGen.current !== gen) {
          setActionFailure({ ...failure, message: `${who}: ${failure.message}` });
        } else {
          setActionFailure(failure);
          if (kind === "pass") setPassLocked(true);
        }
      } finally {
        busyRef.current = false;
        setBusy(null);
      }
    },
    [askId, blockerSaving, current, matches, passLocked],
  );

  // ← passes and → sends, unless the user is typing somewhere.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      // A held key repeats; acting on repeats would pass on or message people never seen.
      if (e.repeat || e.isComposing || e.altKey || e.ctrlKey || e.metaKey) return;
      if (target && (target.closest("input, textarea, select, [contenteditable=true]") || target.isContentEditable)) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        void act("pass");
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        void act("send");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [act]);

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (busyRef.current || passLocked || (e.target as HTMLElement).closest("a, button")) return;
    drag.current = { x: e.clientX, id: e.pointerId };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (drag.current?.id === e.pointerId) setDx(e.clientX - drag.current.x);
  }
  function onPointerUp(e: PointerEvent<HTMLDivElement>) {
    if (drag.current?.id !== e.pointerId) return;
    drag.current = null;
    const outcome: Swipe = swipeOutcome(dx);
    if (outcome) void act(outcome);
    else setDx(0);
  }

  async function toggleBlocker(enabled: boolean) {
    // One change at a time, and not while a pass or send is saving.
    if (blockerSaving || busyRef.current) return;
    setBlockerSaving(true);
    setBlockerFailed(null);
    try {
      const res = await fetch("/api/soft-blocker", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ askId, enabled }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setBlockerFailed(blockerFailure(res.status, body));
        return;
      }
      const saved = (body as { enabled: boolean }).enabled;
      setBlocker(saved);
      rememberBlocker(askId, saved);
      setAnnounce(saved ? "People you passed on are hidden." : "People you passed on are back in the list.");
      refresh();
    } catch {
      setBlockerFailed(blockerFailure(0, null));
    } finally {
      setBlockerSaving(false);
    }
  }

  function onSearch(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setCutoffNote(false);
    setLoad({ state: "loading" });
    setApplied(query.trim());
    setAttempt((n) => n + 1); // reload even when the query didn't change
  }

  if (!askId) {
    return (
      <div className="mx-auto max-w-xl">
        <h1 className={headingClass}>Matches</h1>
        <p className="mt-4 text-lg">Ask a question first, then Convo finds people who can answer it.</p>
        <div className="mt-6">
          <Button href="/ask">Ask a question</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col">
      <h1 className={headingClass}>People who can help</h1>
      {question && (
        <p className="mt-3 text-lg text-muted">
          <span className="sr-only">Your question: </span>&ldquo;{question}&rdquo;
        </p>
      )}

      <form role="search" onSubmit={onSearch} className="mt-6 flex gap-2">
        <label htmlFor="match-search" className="sr-only">
          Narrow the list
        </label>
        <input
          id="match-search"
          type="search"
          value={query}
          maxLength={200}
          placeholder="Narrow the list, e.g. Rust"
          onChange={(e) => setQuery(e.target.value)}
          className="min-h-12 min-w-0 flex-1 rounded-xl border-2 border-border bg-surface px-4 text-base placeholder:text-muted focus-visible:border-accent focus-visible:outline-none"
        />
        <Button type="submit" variant="secondary" className="shrink-0">
          Search
        </Button>
      </form>
      {applied && (
        <p className="mt-2 text-sm text-muted">
          Showing people for &ldquo;{applied}&rdquo;.{" "}
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setCutoffNote(false);
              setLoad({ state: "loading" });
              setApplied("");
              setAttempt((n) => n + 1);
            }}
            className="font-semibold text-accent underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-accent"
          >
            Show everyone
          </button>
        </p>
      )}

      <div className="mt-4 rounded-xl border-2 border-border bg-surface px-4 py-3">
        <label className="flex min-h-11 cursor-pointer items-center gap-4 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-4 has-[:focus-visible]:outline-accent">
          <span className="flex-1 font-semibold">Keep people I pass on hidden</span>
          <input
            type="checkbox"
            role="switch"
            checked={blocker ?? true}
            aria-disabled={blockerSaving || busy !== null}
            onChange={(e) => void toggleBlocker(e.target.checked)}
            aria-describedby="blocker-hint"
            className="peer sr-only"
          />
          <span
            aria-hidden="true"
            className="relative h-7 w-12 shrink-0 rounded-full bg-[var(--skeleton)] transition-colors peer-checked:bg-accent peer-aria-disabled:opacity-50 after:absolute after:left-1 after:top-1 after:size-5 after:rounded-full after:bg-surface after:shadow after:transition-[left] peer-checked:after:left-6 motion-reduce:transition-none motion-reduce:after:transition-none"
          />
        </label>
        <p id="blocker-hint" className="mt-1 text-sm text-muted">
          {blocker === null
            ? "New questions start with this on. If you changed it in another tab, set it again here."
            : blocker
              ? "On: people you passed on stay out of this list, and you're kept out of theirs."
              : "Off: people you passed on can show up again."}
        </p>
        {blockerFailed && (
          <p role="alert" className={`mt-2 ${errorClass}`}>
            {blockerFailed.message}
            {blockerFailed.action && (
              <>
                {" "}
                <a href={blockerFailed.action.href} className="underline underline-offset-4">
                  {blockerFailed.action.label}
                </a>
              </>
            )}
          </p>
        )}
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {announce}
      </p>

      <section aria-label="Matches" className="mt-6">
        {load.state === "loading" && (
          <div aria-busy="true" className="flex flex-col gap-3 rounded-2xl bg-surface p-5 ring-1 ring-border">
            <p role="status">Finding people…</p>
            <span className="h-3 w-3/4 rounded-full bg-[var(--skeleton)] motion-safe:animate-pulse" aria-hidden="true" />
            <span className="h-3 w-1/2 rounded-full bg-[var(--skeleton)] motion-safe:animate-pulse" aria-hidden="true" />
          </div>
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
                <Button onClick={refresh}>Try again</Button>
              )}
            </div>
          </div>
        )}

        {load.state === "ready" && current && (
          <>
            {cutoffNote && (
              <p className="mb-3 rounded-xl border-2 border-border px-4 py-3 text-sm">
                You&apos;ve passed on three people, so Convo hid everyone ranked below them.
              </p>
            )}
            <div
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={() => {
                drag.current = null;
                setDx(0);
              }}
              style={{ transform: dx ? `translateX(${dx}px) rotate(${dx / 25}deg)` : undefined }}
              className={`relative touch-pan-y select-none ${dx ? "" : "transition-transform duration-200 motion-reduce:transition-none"}`}
            >
              {dx !== 0 && (
                <span
                  aria-hidden="true"
                  className={`absolute top-12 z-10 rounded-lg border-4 px-3 py-1 text-xl font-extrabold uppercase ${dx > 0 ? "left-4 rotate-[-10deg] border-accent text-accent" : "right-4 rotate-[10deg] border-[var(--danger-border)] text-[var(--danger)]"}`}
                  style={{ opacity: Math.min(1, Math.abs(dx) / 110) }}
                >
                  {dx > 0 ? "Send" : "Pass"}
                </span>
              )}
              <MatchCard key={current.person.id} match={current} position={`${index + 1} of ${matches.length}`} />
            </div>

            {actionFailure && (
              <p role="alert" className={`mt-4 ${errorClass}`}>
                {actionFailure.message}{" "}
                {actionFailure.action ? (
                  <a href={actionFailure.action.href} className="underline underline-offset-4">
                    {actionFailure.action.label}
                  </a>
                ) : (
                  <button type="button" onClick={refresh} className="underline underline-offset-4">
                    Refresh matches
                  </button>
                )}
              </p>
            )}

            <div className="sticky bottom-0 -mx-4 mt-5 grid grid-cols-2 gap-3 bg-background/95 px-4 pb-4 pt-3 backdrop-blur sm:static sm:mx-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
              <Button
                variant="secondary"
                onClick={() => void act("pass")}
                aria-disabled={busy !== null || passLocked || blockerSaving}
                className="text-lg aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
              >
                <span aria-hidden="true">←&nbsp;</span>
                {busy === "pass" ? "Passing…" : "Pass"}
              </Button>
              <Button
                onClick={() => void act("send")}
                aria-disabled={busy !== null || passLocked || blockerSaving}
                className="text-lg aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
              >
                {busy === "send" ? "Sending…" : "Send request"}
                <span aria-hidden="true">&nbsp;→</span>
              </Button>
            </div>
            <p className="mt-3 text-center text-sm text-muted">Swipe the card, or use the ← and → keys.</p>
          </>
        )}

        {load.state === "ready" && !current && (
          <div className="rounded-2xl border-2 border-border bg-surface p-6">
            <h2 className="text-2xl font-extrabold tracking-tight">
              {matches.length === 0 ? "No one matches yet" : "That's everyone for now"}
            </h2>
            {cutoffNote && (
              <p className="mt-2 font-medium">
                You&apos;ve passed on three people, so Convo hid everyone ranked below them.
              </p>
            )}
            <p className="mt-2 text-muted">
              {sent.length > 0
                ? `You sent ${sent.length === 1 ? "a request" : `${sent.length} requests`} to ${sent.join(", ")}. They'll see your question in their inbox.`
                : applied
                  ? "Try a different search, or show everyone."
                  : "Try asking it another way, or check back as more people join."}
            </p>
            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <Button href="/ask">Ask something else</Button>
              {matches.length > 0 && (
                <Button variant="secondary" onClick={refresh}>
                  See them again
                </Button>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

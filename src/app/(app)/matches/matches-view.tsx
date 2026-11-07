"use client";

/**
 * A2 steps 1 and 2: the people Lanyard found for an ask, as a short list.
 * Each row shows who they are and why they were picked; tapping it opens
 * their full profile with Pass and Send request. After either, the next
 * person opens. A search box narrows the list.
 *
 * Saves follow db/Rejections.md and db/Requests.md: one at a time, never
 * retried automatically, and a failed pass locks that person's actions
 * until Refresh matches shows what was saved (every pass counts). After
 * three passes the server may hide everyone ranked below them; the list
 * follows the returned cutoff.
 *
 * A2 step 3: the soft-blocker switch (PUT /api/soft-blocker). On, people
 * passed on for this ask stay hidden here (and, on the real backend, this
 * user is hidden from them); off brings them back. The batch cutoff stays
 * either way. Changing it reloads the matches.
 *
 * A2 step 5: "Mark as answered" resolves the ask (POST /api/asks/:id/resolve),
 * so it stops being matched or counted, then suggests staying in touch with
 * the people sent requests from this screen, via their public GitHub.
 */
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { githubProfile } from "@/components/ui/person-badge";
import type { MatchResult, Request, RequestView } from "@/contracts/types";
import { recallAsk } from "../ask/asks";
import { MatchDetails, MatchSummary } from "./match-card";
import {
  blockerFailure,
  loadAsk,
  matchFailure,
  passFailure,
  resolveFailure,
  sendFailure,
  withinCutoff,
  type Failure,
} from "./matches";

const headingClass =
  "text-[2.2rem] font-extrabold leading-[1.02] tracking-[-0.03em] [font-stretch:85%] sm:text-5xl";
const errorClass = "text-sm font-medium text-[var(--danger)]";

type Load =
  | { state: "loading" }
  | { state: "ready"; matches: MatchResult[] }
  | { state: "failed"; failure: Failure };

/** Keyed by the ask, so nothing from one ask (its switch setting, deck or answers) shows on another. */
export function MatchesView() {
  const askId = useSearchParams().get("ask") ?? "";
  return <AskMatches key={askId} askId={askId} />;
}

function AskMatches({ askId }: { askId: string }) {
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  /** The person whose full profile is open (one at a time), or null. */
  const [openId, setOpenId] = useState<string | null>(null);
  /** Set by a pass or send: move keyboard focus to the next person's row once it opens. */
  const focusAfterAction = useRef(false);
  useEffect(() => {
    if (!focusAfterAction.current) return;
    focusAfterAction.current = false;
    // With no one left, the count goes too, so land on the end panel's heading.
    const target = openId
      ? document.getElementById(`match-${openId}-toggle`)
      : (document.getElementById("matches-count") ?? document.getElementById("matches-done"));
    target?.focus();
  }, [openId]);
  const [busy, setBusy] = useState<"pass" | "send" | null>(null);
  const [actionFailure, setActionFailure] = useState<Failure | null>(null);
  /**
   * Everyone whose pass failed: the server may have saved it, and every
   * pass counts (three hide the rest), so their actions stay off until
   * Refresh matches shows what was saved. A second failure adds to the set;
   * only a successful reload clears it.
   */
  const [lockedIds, setLockedIds] = useState<ReadonlySet<string>>(() => new Set());
  const lock = (id: string) => setLockedIds((cur) => new Set(cur).add(id));
  /**
   * Set by a successful pass: an emptied list then means "you've seen everyone",
   * not "no one matches". A new search starts a new list, so it clears this.
   */
  const [passedAny, setPassedAny] = useState(false);
  /** The save in flight, as a ref: state only updates after a re-render, too late to stop a second press. */
  const busyRef = useRef(false);
  const [announce, setAnnounce] = useState("");
  const [sent, setSent] = useState<RequestView[]>([]);
  const [sentStatus, setSentStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [sentAttempt, setSentAttempt] = useState(0);
  const [resolving, setResolving] = useState(false);
  const [resolved, setResolved] = useState(false);
  const [resolveFailed, setResolveFailed] = useState<Failure | null>(null);
  const [cutoffNote, setCutoffNote] = useState(false);
  /** Bumped whenever the deck reloads, so a pass or send answered after a reload can't move the new deck. */
  const deckGen = useRef(0);
  const [question, setQuestion] = useState<string | null>(null);
  /** The saved soft-blocker setting; null until GET /api/asks/:id answers, so the switch never shows a guess. */
  const [blocker, setBlocker] = useState<boolean | null>(null);
  /** The setting didn't load for a reason Try again can fix. */
  const [askFailed, setAskFailed] = useState(false);
  const [askAttempt, setAskAttempt] = useState(0);
  const blockerRef = useRef<boolean | null>(null);
  useEffect(() => {
    blockerRef.current = blocker;
  }, [blocker]);
  const [blockerSaving, setBlockerSaving] = useState(false);
  const [blockerFailed, setBlockerFailed] = useState<Failure | null>(null);

  // The saved ask: its question and the switch's real setting, so a new tab or another device shows them too.
  useEffect(() => {
    if (!askId) return;
    let live = true;
    void (async () => {
      setQuestion(recallAsk(askId)?.refined.text ?? null); // this tab's copy, shown until the server answers
      const ask = await loadAsk(askId);
      if (!live) return;
      // The matches load separately and may still show, so say the setting didn't.
      // A 401 or 404 fails the match load too, which explains it.
      if (typeof ask === "number") return setAskFailed(ask !== 401 && ask !== 404);
      setQuestion(ask.refined?.text ?? ask.rawText);
      setBlocker(ask.softBlocker);
    })();
    return () => {
      live = false;
    };
  }, [askId, askAttempt]);

  useEffect(() => {
    if (!askId) return;
    let live = true;
    void (async () => {
      try {
        const response = await fetch("/api/requests/sent", { cache: "no-store" });
        if (!response.ok) throw new Error("Sent requests unavailable");
        const requests = ((await response.json()) as RequestView[]).filter(request => request.askId === askId);
        if (!live) return;
        // A send may finish while this snapshot loads; retain that successful response too.
        setSent(current => [...new Map([...requests, ...current].map(request => [request.id, request])).values()]);
        setSentStatus("ready");
      } catch {
        if (live) setSentStatus("failed");
      }
    })();
    return () => { live = false; };
  }, [askId, sentAttempt]);

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
        if (!res.ok) return setLoad({ state: "failed", failure: matchFailure(res.status, body) });
        setLoad({ state: "ready", matches: [...(body as MatchResult[])].sort((a, b) => a.rank - b.rank) });
        setOpenId(null);
        setLockedIds(new Set());
      } catch {
        if (live) setLoad({ state: "failed", failure: matchFailure(0, null) });
      }
    })();
    return () => {
      live = false;
    };
  }, [askId, applied, attempt]);

  const matches = useMemo(() => (load.state === "ready" ? load.matches : []), [load]);
  const sentIds = useMemo(() => new Set(sent.flatMap((r) => (r.person ? [r.person.id] : [r.toPersonId]))), [sent]);
  /** Nobody left to answer: the list is empty, or everyone still in it has your request. */
  const allDone = matches.every((m) => sentIds.has(m.person.id));
  /** The list was emptied by you (sends, passes or the cutoff), not by a lack of people. */
  const reviewed = sent.length > 0 || cutoffNote || passedAny;

  /** What the end panel says under its heading. */
  function endNote() {
    if (sent.length > 0) {
      const names = sent.map((request) => request.person?.name ?? "someone at the conference").join(", ");
      return `You sent ${sent.length === 1 ? "a request" : `${sent.length} requests`} to ${names}. They'll see your question in their inbox.`;
    }
    if (passedAny) {
      const hint = blocker === false ? "" : " To see them again, turn off “Keep people I pass on hidden”.";
      return `You passed on everyone Lanyard found.${hint}`;
    }
    return applied ? "Try a different search, or show everyone." : "Try asking it another way, or check back as more people join.";
  }

  // Reloading while a pass or send is saving would let that save land on the new list,
  // so every reload (Refresh, Search, Show everyone, See them again) waits for it.
  function refresh() {
    if (busyRef.current) return;
    setActionFailure(null);
    setLoad({ state: "loading" });
    setAttempt((n) => n + 1);
  }

  const act = useCallback(
    async (kind: "pass" | "send", match: MatchResult) => {
      if (busyRef.current || lockedIds.has(match.person.id) || blockerSaving) return;
      busyRef.current = true;
      setBusy(kind);
      setActionFailure(null);
      const who = match.person.name;
      const gen = deckGen.current;
      /** After acting on someone, open the next person still waiting for an answer. */
      const openNext = (list: MatchResult[]) => {
        const next = list.find((m) => m.rank > match.rank && m.person.id !== match.person.id && !sentIds.has(m.person.id));
        focusAfterAction.current = true; // the buttons go with the closed row; keep the keyboard's place
        setOpenId(next ? next.person.id : null);
      };
      try {
        const res =
          kind === "pass"
            ? await fetch("/api/rejections", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ askId, personId: match.person.id, rank: match.rank }),
              })
            : await fetch("/api/requests", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ askId, toPersonId: match.person.id }),
              });
        const body = await res.json().catch(() => null);
        // If the list reloaded meanwhile (Search, Refresh or the switch), the result, a failure,
        // and who was sent the ask still count; only the open row stays as it is.
        const stale = deckGen.current !== gen;
        if (!res.ok) {
          const failure = kind === "pass" ? passFailure(res.status, body) : sendFailure(res.status, body);
          setActionFailure({ ...failure, message: `${who}: ${failure.message}` });
          if (kind === "pass" && !stale) lock(match.person.id);
          return;
        }
        if (kind === "send") {
          const saved: RequestView = { ...(body as Request), type: null, person: match.person };
          setSent((previous) => [...previous.filter((request) => request.id !== saved.id), saved]);
          setAnnounce(`Request sent to ${who}.`);
          if (!stale) openNext(matches);
          return;
        }
        // A pass: they leave the list (unless the switch is off), and the server's cutoff may hide more.
        const cutoff = (body as { hiddenBelowRank: number | null }).hiddenBelowRank;
        setAnnounce(`Passed on ${who}.`);
        setPassedAny(true);
        const passedId = match.person.id;
        const apply = (list: MatchResult[]) =>
          withinCutoff(blockerRef.current === false ? list : list.filter((m) => m.person.id !== passedId), cutoff);
        if (stale) {
          setLoad((cur) => (cur.state === "ready" ? { state: "ready", matches: apply(cur.matches) } : cur));
          return;
        }
        const kept = apply(matches);
        if (cutoff !== null && withinCutoff(matches, cutoff).length < matches.length) setCutoffNote(true);
        setLoad({ state: "ready", matches: kept });
        openNext(kept);
      } catch {
        const failure = kind === "pass" ? passFailure(0, null) : sendFailure(0, null);
        setActionFailure({ ...failure, message: `${who}: ${failure.message}` });
        if (kind === "pass" && deckGen.current === gen) lock(match.person.id);
      } finally {
        busyRef.current = false;
        setBusy(null);
      }
    },
    [askId, blockerSaving, lockedIds, matches, sentIds],
  );

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
      setAnnounce(saved ? "People you passed on are hidden." : "People you passed on are back in the list.");
      refresh();
    } catch {
      setBlockerFailed(blockerFailure(0, null));
    } finally {
      setBlockerSaving(false);
    }
  }

  async function resolve() {
    if (resolving) return;
    setResolving(true);
    setResolveFailed(null);
    try {
      const res = await fetch(`/api/asks/${encodeURIComponent(askId)}/resolve`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setResolveFailed(resolveFailure(res.status, body));
        return;
      }
      setResolved(true);
      setAnnounce("Marked as answered.");
    } catch {
      setResolveFailed(resolveFailure(0, null));
    } finally {
      setResolving(false);
    }
  }

  function onSearch(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busyRef.current) return;
    setCutoffNote(false);
    setPassedAny(false);
    setLoad({ state: "loading" });
    setApplied(query.trim());
    setAttempt((n) => n + 1); // reload even when the query didn't change
  }

  const sentNotice = sentStatus === "loading" ? <p role="status">Loading your sent requests…</p> : sentStatus === "failed" ? (
    <p role="alert" className={errorClass}>
      Your sent requests didn&apos;t load.{" "}
      <button type="button" className="underline underline-offset-4" onClick={() => {
        setSentStatus("loading");
        setSentAttempt(value => value + 1);
      }}>Try again</button>
    </p>
  ) : null;

  if (!askId) {
    return (
      <div className="mx-auto max-w-xl">
        <h1 className={headingClass}>Matches</h1>
        <p className="mt-4 text-lg">Ask a question first, then Lanyard finds people who can answer it.</p>
        <div className="mt-6">
          <Button href="/ask">Ask a question</Button>
        </div>
      </div>
    );
  }

  if (resolved) {
    return (
      <div className="mx-auto flex max-w-xl flex-col">
        <h1 className={headingClass}>Marked as answered</h1>
        <p className="mt-3 text-lg text-muted">
          Lanyard won&apos;t match this question with anyone new. Your requests and meetings stay as they are.
        </p>
        {question && <p className="mt-2 text-muted">&ldquo;{question}&rdquo;</p>}
        {sentNotice}
        {sent.some(request => request.person) && (
          <section aria-labelledby="connect-heading" className="mt-8 rounded-2xl border-2 border-border bg-surface p-5">
            <h2 id="connect-heading" className="text-xl font-extrabold tracking-tight">
              Stay in touch
            </h2>
            <p className="mt-1 text-sm text-muted">Say thanks, or follow the people you reached out to.</p>
            <ul className="mt-3 flex flex-col gap-2">
              {sent.flatMap(request => request.person ? [request.person] : []).map((p) => (
                <li key={p.id}>
                  <a
                    href={githubProfile(p.githubLogin)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-h-11 items-center justify-between gap-3 rounded-lg border-2 border-border px-3 font-semibold hover:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    <span>{p.name}</span>
                    <span className="text-sm text-accent">
                      @{p.githubLogin} on GitHub<span className="sr-only"> (opens in a new tab)</span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
        <div className="mt-8">
          <Button href="/ask">Ask something else</Button>
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
        <Button
          type="submit"
          variant="secondary"
          aria-disabled={busy !== null}
          className="shrink-0 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
        >
          Search
        </Button>
      </form>
      {applied && (
        <p className="mt-2 text-sm text-muted">
          Showing people for &ldquo;{applied}&rdquo;.{" "}
          <button
            type="button"
            onClick={() => {
              if (busyRef.current) return;
              setQuery("");
              setCutoffNote(false);
              setPassedAny(false);
              setLoad({ state: "loading" });
              setApplied("");
              setAttempt((n) => n + 1);
            }}
            aria-disabled={busy !== null}
            className="font-semibold text-accent underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-accent aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
          >
            Show everyone
          </button>
        </p>
      )}

      {blocker !== null && (
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
          {blocker
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
      )}
      {askFailed && (
        <p role="alert" className={`mt-4 ${errorClass}`}>
          The &ldquo;Keep people I pass on hidden&rdquo; setting didn&apos;t load.{" "}
          <button
            type="button"
            onClick={() => {
              setAskFailed(false);
              setAskAttempt((n) => n + 1);
            }}
            className="underline underline-offset-4"
          >
            Try again
          </button>
        </p>
      )}
      {sentNotice}

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

        {load.state === "ready" && matches.length > 0 && (
          <>
            <p id="matches-count" tabIndex={-1} className="mb-3 text-xl font-extrabold tracking-tight focus:outline-none">
              {matches.length} {matches.length === 1 ? "person" : "people"} found
            </p>
            {cutoffNote && (
              <p className="mb-3 rounded-xl border-2 border-border px-4 py-3 text-sm">
                You&apos;ve passed on three people, so Lanyard hid everyone ranked below them.
              </p>
            )}
            {actionFailure && (
              <p role="alert" className={`mb-3 ${errorClass}`}>
                {actionFailure.message}{" "}
                {actionFailure.action ? (
                  <a href={actionFailure.action.href} className="underline underline-offset-4">
                    {actionFailure.action.label}
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={refresh}
                    aria-disabled={busy !== null}
                    className="underline underline-offset-4 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                  >
                    Refresh matches
                  </button>
                )}
              </p>
            )}
            <ul className="flex flex-col gap-2">
              {matches.map((m) => {
                const open = openId === m.person.id;
                const isSent = sentIds.has(m.person.id);
                const off = busy !== null || lockedIds.has(m.person.id) || blockerSaving;
                const panelId = `match-${m.person.id}-panel`;
                return (
                  <li
                    key={m.person.id}
                    className={`overflow-hidden rounded-2xl border-2 bg-surface transition-colors motion-reduce:transition-none ${open ? "border-accent" : "border-border"}`}
                  >
                    <button
                      id={`match-${m.person.id}-toggle`}
                      type="button"
                      aria-expanded={open}
                      aria-controls={panelId}
                      onClick={() => setOpenId(open ? null : m.person.id)}
                      className="flex w-full items-start gap-2 px-4 py-3 hover:bg-accent/5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
                    >
                      <MatchSummary match={m} sent={isSent} />
                      <span aria-hidden="true" className={`mt-2 shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`}>
                        ▾
                      </span>
                    </button>
                    {open && (
                      <div id={panelId} role="region" aria-labelledby={`match-${m.person.id}-name`} className="border-t-2 border-border px-4 pb-4 pt-4">
                        <MatchDetails match={m} nameId={`match-${m.person.id}-name`} />
                        {isSent ? (
                          <p className="mt-4 font-semibold">You sent {m.person.name} your question. They&apos;ll see it in their inbox.</p>
                        ) : (
                          <div className="mt-5 grid grid-cols-2 gap-3">
                            <Button
                              variant="secondary"
                              onClick={() => void act("pass", m)}
                              aria-disabled={off}
                              className="text-lg aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                            >
                              {busy === "pass" ? "Passing…" : "Pass"}
                            </Button>
                            <Button
                              onClick={() => void act("send", m)}
                              aria-disabled={off}
                              className="text-lg aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                            >
                              {busy === "send" ? "Sending…" : "Send request"}
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {load.state === "ready" && allDone && (
          <div className={`rounded-2xl border-2 border-border bg-surface p-6 ${matches.length > 0 ? "mt-4" : ""}`}>
            <h2 id="matches-done" tabIndex={-1} className="text-2xl font-extrabold tracking-tight focus:outline-none">
              {reviewed ? "That's everyone for now" : "No one matches yet"}
            </h2>
            {cutoffNote && (
              <p className="mt-2 font-medium">
                You&apos;ve passed on three people, so Lanyard hid everyone ranked below them.
              </p>
            )}
            <p className="mt-2 text-muted">{endNote()}</p>
            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <Button href="/ask">Ask something else</Button>
              {reviewed && (
                <Button variant="secondary" onClick={refresh}>
                  See them again
                </Button>
              )}
            </div>
          </div>
        )}
      </section>

      {load.state === "ready" && (
        <div className="mt-10 border-t-2 border-border pt-6">
          <h2 className="text-lg font-bold">Got what you needed?</h2>
          <p className="mt-1 text-sm text-muted">Marking it answered stops Lanyard matching this question with anyone new.</p>
          <div className="mt-3">
            <Button variant="secondary" onClick={() => void resolve()} disabled={resolving}>
              {resolving ? "Saving…" : "Mark as answered"}
            </Button>
          </div>
          {resolveFailed && (
            <p role="alert" className={`mt-3 ${errorClass}`}>
              {resolveFailed.message}
              {resolveFailed.action && (
                <>
                  {" "}
                  <a href={resolveFailed.action.href} className="underline underline-offset-4">
                    {resolveFailed.action.label}
                  </a>
                </>
              )}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

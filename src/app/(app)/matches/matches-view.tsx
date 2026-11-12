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
import { BackLink } from "@/components/ui/back-link";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { githubProfile } from "@/components/ui/person-badge";
import type { MatchResult, Request, RequestView } from "@/contracts/types";
import { recallAsk } from "../ask/asks";
import { MatchDetails, MatchSummary } from "./match-card";
import {
  blockerFailure,
  loadAsk,
  matchFailure,
  onlyNearest,
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

/** What an open profile says instead of Pass and Send once you've answered that person, or null. */
function doneNote(name: string, sent: boolean, passed: boolean): string | null {
  if (sent) return `You sent ${name} your question. They'll see it in their inbox.`;
  if (passed) return `You passed on ${name}.`;
  return null;
}

/** Keyed by the ask, so nothing from one ask (its switch setting, deck or answers) shows on another. */
export function MatchesView() {
  const askId = useSearchParams().get("ask") ?? "";
  return (
    <>
      <div className="mx-auto flex max-w-xl flex-col">
        {/* Back to this question on the ask screen (it reads the saved ask back), not an empty box. */}
        {askId ? (
          <BackLink href={`/ask?ask=${encodeURIComponent(askId)}`} label="Back to your question" />
        ) : (
          <BackLink href="/ask" label="Back to Ask" />
        )}
      </div>
      <AskMatches key={askId} askId={askId} />
    </>
  );
}

function AskMatches({ askId }: { askId: string }) {
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  /** The person whose full profile is open (one at a time), or null. */
  const [openId, setOpenId] = useState<string | null>(null);
  /**
   * Set after a pass or send: keep the keyboard's place once the list updates. It runs once per
   * action (not on every change of the open row), and only if focus is still on the person acted on,
   * or was lost because their buttons went away; if the user moved on (another row, the search box),
   * it leaves focus alone.
   */
  const [focusRequest, setFocusRequest] = useState<{ actedId: string; n: number } | null>(null);
  useEffect(() => {
    if (!focusRequest) return;
    const active = document.activeElement;
    const actedRow = document.getElementById(`match-${focusRequest.actedId}-item`);
    if (active && active !== document.body && !actedRow?.contains(active)) return;
    // The next open person's row; with no one left to answer, the end panel; else the count.
    const target =
      document.querySelector<HTMLElement>('[id^="match-"][id$="-toggle"][aria-expanded="true"]') ??
      document.getElementById("matches-done") ??
      document.getElementById("matches-count");
    target?.focus();
  }, [focusRequest]);
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
   * People passed on in this visit. With the switch on they leave the list; with it off they stay,
   * marked "Passed", and count as done. A reload clears this: the server lists them again, unmarked,
   * as the switch's own hint says ("people you passed on can show up again").
   */
  const [passedIds, setPassedIds] = useState<ReadonlySet<string>>(() => new Set());
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
  /** No one matched and the user chose to leave the request open. */
  const [keptOpen, setKeptOpen] = useState(false);
  /** Closed from the empty screen, so the closing page doesn't say it was answered. */
  const [closedEmpty, setClosedEmpty] = useState(false);
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
        setPassedIds(new Set());
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
  /** Nobody left to answer: the list is empty, or everyone still in it has your request or was passed on. */
  const allDone = matches.every((m) => sentIds.has(m.person.id) || passedIds.has(m.person.id));
  /**
   * The requests that explain this list: those to people in it, plus, without a search, earlier
   * ones (the server leaves those people out). A search that finds no one isn't explained by them.
   */
  const sentHere = applied
    ? sent.filter((request) => matches.some((m) => m.person.id === (request.person?.id ?? request.toPersonId)))
    : sent;
  /** This list was emptied by you (passes, the cutoff, or your requests), not by a lack of people. */
  const reviewed = passedAny || cutoffNote || sentHere.length > 0;
  /** No one to show and none of it your doing: the empty panel goes first, with no switch. */
  const noMatches = load.state === "ready" && matches.length === 0 && !reviewed;
  /** A reload only brings people back when you passed on someone with the switch off. */
  const canSeeAgain = passedAny && blocker === false;

  /** What the end panel says under its heading. */
  function endNote() {
    // The cutoff line above explains who's gone; a reload or the switch doesn't bring them back.
    if (cutoffNote) return "Try asking it another way, or check back as more people join.";
    if (sentHere.length > 0) {
      const names = sentHere.map((request) => request.person?.name ?? "someone at the conference").join(", ");
      return `You sent ${sentHere.length === 1 ? "a request" : `${sentHere.length} requests`} to ${names}. They'll see your question in their inbox.`;
    }
    if (passedAny) {
      // Only while the switch is on are they gone; with it off, See them again lists them unmarked.
      const hint = blocker === true ? " To see them again, turn off “Keep people I pass on hidden”." : "";
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
      /**
       * After acting on someone, open the next person still waiting for an answer, unless the user
       * opened someone else while the save ran.
       */
      const openNext = (list: MatchResult[]) => {
        const next = list.find(
          (m) => m.rank > match.rank && m.person.id !== match.person.id && !sentIds.has(m.person.id) && !passedIds.has(m.person.id),
        );
        setOpenId((current) => (current === match.person.id ? (next?.person.id ?? null) : current));
        setFocusRequest((previous) => ({ actedId: match.person.id, n: (previous?.n ?? 0) + 1 }));
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
        setPassedIds((cur) => new Set(cur).add(match.person.id));
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
    [askId, blockerSaving, lockedIds, matches, passedIds, sentIds],
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

  async function resolve(empty = false) {
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
      setClosedEmpty(empty);
      setResolved(true);
      setAnnounce(empty ? "Request closed." : "Marked as answered.");
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
    // Only people with a GitHub can be followed from here.
    const contacts = sent.flatMap(({ person }) =>
      person?.githubLogin ? [{ id: person.id, name: person.name, login: person.githubLogin }] : [],
    );
    return (
      <div className="mx-auto flex max-w-xl flex-col">
        <h1 className={headingClass}>{closedEmpty ? "Request closed" : "Marked as answered"}</h1>
        <p className="mt-3 text-lg text-muted">
          Lanyard won&apos;t match this question with anyone new. Your requests and meetings stay as they are.
        </p>
        {question && <p className="mt-2 text-muted">&ldquo;{question}&rdquo;</p>}
        {sentNotice}
        {contacts.length > 0 && (
          <section aria-labelledby="connect-heading" className="mt-8 rounded-2xl border-2 border-border bg-surface p-5">
            <h2 id="connect-heading" className="text-xl font-extrabold tracking-tight">
              Stay in touch
            </h2>
            <p className="mt-1 text-sm text-muted">Say thanks, or follow the people you reached out to.</p>
            <ul className="mt-3 flex flex-col gap-2">
              {contacts.map((p) => (
                <li key={p.id}>
                  <a
                    href={githubProfile(p.login)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-h-11 items-center justify-between gap-3 rounded-lg border-2 border-border px-3 font-semibold hover:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    <span>{p.name}</span>
                    <span className="text-sm text-accent">
                      @{p.login} on GitHub<span className="sr-only"> (opens in a new tab)</span>
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

  const resolveError = resolveFailed && (
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
  );

  const matchesSection = (
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
          {onlyNearest(matches)
            ? `No close match. ${matches.length === 1 ? "The nearest person" : `The ${matches.length} nearest people`}`
            : `${matches.length} ${matches.length === 1 ? "person" : "people"} found`}
        </p>
        {onlyNearest(matches) && (
          <p className="mb-3 text-muted">
            No one here works on exactly this. {matches.length === 1 ? "This person does" : "These people do"} related work and may still help.
          </p>
        )}
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
            const isPassed = passedIds.has(m.person.id);
            const note = doneNote(m.person.name, isSent, isPassed);
            const off = busy !== null || lockedIds.has(m.person.id) || blockerSaving;
            const panelId = `match-${m.person.id}-panel`;
            return (
              <li
                key={m.person.id}
                id={`match-${m.person.id}-item`}
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
                  <MatchSummary match={m} sent={isSent} passed={isPassed} />
                  <span
                    aria-hidden="true"
                    className={`mt-1 flex size-10 shrink-0 items-center justify-center rounded-full border-2 transition-colors motion-reduce:transition-none ${
                      open ? "border-accent bg-accent text-on-accent" : "border-border bg-background text-foreground"
                    }`}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className={`size-6 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.75"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </span>
                </button>
                {open && (
                  <div id={panelId} role="region" aria-labelledby={`match-${m.person.id}-name`} className="border-t-2 border-border px-4 pb-4 pt-4">
                    <MatchDetails match={m} nameId={`match-${m.person.id}-name`} />
                    {lockedIds.has(m.person.id) && (
                      <p className={`mt-4 ${errorClass}`}>
                        Lanyard couldn&apos;t confirm your pass on {m.person.name}, so Pass and Send are off until you{" "}
                        <button
                          type="button"
                          onClick={refresh}
                          aria-disabled={busy !== null}
                          className="underline underline-offset-4 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                        >
                          refresh the matches
                        </button>{" "}
                        to see what was saved.
                      </p>
                    )}
                    {note ? (
                      <p className="mt-4 font-semibold">{note}</p>
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
          {reviewed ? "That's everyone for now" : applied ? "No one matches your search" : "No one matches yet"}
        </h2>
        {cutoffNote && (
          <p className="mt-2 font-medium">
            You&apos;ve passed on three people, so Lanyard hid everyone ranked below them.
          </p>
        )}
        <p className="mt-2 text-muted">{endNote()}</p>
        {/* An empty search says nothing about the ask, so it never offers to close it. */}
        {noMatches && !applied ? (
          <div className="mt-5 border-t-2 border-border pt-5">
            {keptOpen ? (
              <p role="status" className="font-semibold">
                Your request stays active. Lanyard will match you as more people join.
              </p>
            ) : (
              <>
                <h3 className="text-lg font-bold">Leave as active request?</h3>
                <p className="mt-1 text-sm text-muted">
                  Yes keeps looking for people as they join. No closes the request.
                </p>
                <div className="mt-3 flex gap-3">
                  <Button onClick={() => setKeptOpen(true)} disabled={resolving}>
                    Yes
                  </Button>
                  <Button variant="secondary" onClick={() => void resolve(true)} disabled={resolving}>
                    {resolving ? "Saving…" : "No"}
                  </Button>
                </div>
                {resolveError}
              </>
            )}
            <div className="mt-5">
              <Button href="/ask" variant="secondary">
                Ask something else
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <Button href="/ask">Ask something else</Button>
            {canSeeAgain && (
              <Button variant="secondary" onClick={refresh}>
                See them again
              </Button>
            )}
          </div>
        )}
      </div>
    )}
  </section>
  );

  return (
    <div className="mx-auto flex max-w-xl flex-col">
      <h1 className={headingClass}>People who can help</h1>
      {question && (
        <p className="mt-3 text-lg text-muted">
          <span className="sr-only">Your question: </span>&ldquo;{question}&rdquo;
        </p>
      )}
      {/* No one matched: say so first, before the search. */}
      {noMatches && matchesSection}

      <label htmlFor="match-search" className="mt-6 block text-lg font-bold">
        Find people who can help
      </label>
      <form role="search" onSubmit={onSearch} className="mt-2 flex gap-2">
        <input
          id="match-search"
          type="search"
          value={query}
          maxLength={200}
          placeholder="Such as university, organisation or country"
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

      {blocker !== null && !noMatches && (
      <div className="mt-4 rounded-xl border-2 border-border bg-surface px-4 py-3">
        <Switch
          boxed={false}
          label="Keep people I pass on hidden"
          checked={blocker ?? false}
          busy={blockerSaving || busy !== null}
          describedBy="blocker-hint"
          onChange={(on) => void toggleBlocker(on)}
        />
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
      {askFailed && !noMatches && (
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

      {!noMatches && matchesSection}

      {load.state === "ready" && !noMatches && (
        <div className="mt-10 border-t-2 border-border pt-6">
          <h2 className="text-lg font-bold">Got what you needed?</h2>
          <p className="mt-1 text-sm text-muted">Marking it answered stops Lanyard matching this question with anyone new.</p>
          <div className="mt-3">
            <Button variant="secondary" onClick={() => void resolve()} disabled={resolving}>
              {resolving ? "Saving…" : "Mark as answered"}
            </Button>
          </div>
          {resolveError}
        </div>
      )}
    </div>
  );
}

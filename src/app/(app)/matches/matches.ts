/**
 * Match screen logic (A2 steps 1 and 2), kept apart from the screen so it
 * can be unit-tested: what a card shows, and what each
 * failed request tells the user.
 *
 * Saving rules from db/Rejections.md and db/Requests.md: one save at a
 * time, never an automatic retry of a POST (a timed-out save may have gone
 * through), and a 503 after a saved rejection says not to resubmit.
 */
import type { Ask, MatchResult } from "@/contracts/types";

/**
 * Evidence snippets as text runs, with Elasticsearch's <em>…</em>
 * highlights marked. Only those literal markers are read; everything else,
 * such as `Option<T>` or `<div>` in code-like evidence, is kept as written.
 * The parts are rendered as text, never as HTML. Plain string scanning,
 * with no regular expression to backtrack.
 */
export function highlightParts(snippet: string): { text: string; hit: boolean }[] {
  const parts: { text: string; hit: boolean }[] = [];
  const push = (text: string, hit: boolean) => {
    if (text) parts.push({ text, hit });
  };
  let rest = snippet;
  for (;;) {
    const open = rest.indexOf("<em>");
    const close = open === -1 ? -1 : rest.indexOf("</em>", open + 4);
    if (open === -1 || close === -1) {
      push(rest, false);
      return parts;
    }
    push(rest.slice(0, open), false);
    push(rest.slice(open + 4, close), true);
    rest = rest.slice(close + 5);
  }
}

export type Failure = { message: string; action: { label: string; href: string } | null };

const serverMessage = (body: unknown) =>
  typeof body === "object" && body && "error" in body && typeof body.error === "string" ? body.error : null;

const signIn = { label: "Sign in again", href: "/signin" };

/** A failed POST /api/match. */
export function matchFailure(status: number, body: unknown): Failure {
  if (status === 401) return { message: "Your sign-in has expired.", action: signIn };
  if (status === 404) return { message: "That question isn't yours or no longer exists.", action: { label: "Ask a question", href: "/ask" } };
  if (status === 409) return { message: "Finish setting up your badge first.", action: { label: "Set up your badge", href: "/signin" } };
  return { message: serverMessage(body) ?? "Matches didn't load. Try again in a moment.", action: null };
}

/** A failed POST /api/rejections. Never retried automatically: refreshing shows what was saved. */
export function passFailure(status: number, body: unknown): Failure {
  if (status === 401) return { message: "Your sign-in has expired.", action: signIn };
  return {
    message: serverMessage(body) ?? "That pass may not have been saved. Refresh the matches to check before passing again.",
    action: null,
  };
}

/** A failed POST /api/requests. */
export function sendFailure(status: number, body: unknown): Failure {
  if (status === 401) return { message: "Your sign-in has expired.", action: signIn };
  if (status === 404) return { message: "That person isn't available any more.", action: null };
  return { message: serverMessage(body) ?? "Your request may not have been sent. Try again in a moment.", action: null };
}

/** The cards still to show once a batch cutoff applies: ranks strictly below it are kept. */
export function withinCutoff(matches: MatchResult[], hiddenBelowRank: number | null): MatchResult[] {
  return hiddenBelowRank === null ? matches : matches.filter((m) => m.rank < hiddenBelowRank);
}

/**
 * True when the AI judged these cards and none fits strongly: the list then says they're the nearest
 * people, not a match. Unjudged cards (fake API, AI unavailable) never trigger it.
 */
export function onlyNearest(matches: MatchResult[]): boolean {
  return matches.some((m) => m.fit) && !matches.some((m) => m.fit === "strong");
}

/** A failed PUT /api/soft-blocker. Safe to repeat, so the user can just try again. */
export function blockerFailure(status: number, body: unknown): Failure {
  if (status === 401) return { message: "Your sign-in has expired.", action: signIn };
  if (status === 404) return { message: "That question isn't yours or no longer exists.", action: { label: "Ask a question", href: "/ask" } };
  return { message: serverMessage(body) ?? "That setting wasn't saved. Try again.", action: null };
}

/**
 * The saved ask (GET /api/asks/:id): its question and soft-blocker setting, so
 * a new tab or device shows them too. When it can't be read, the status
 * instead (0 when offline).
 */
export async function loadAsk(askId: string): Promise<Ask | number> {
  try {
    const res = await fetch(`/api/asks/${encodeURIComponent(askId)}`, { cache: "no-store" });
    return res.ok ? ((await res.json()) as Ask) : res.status;
  } catch {
    return 0;
  }
}

/** A failed POST /api/asks/:id/resolve. Repeating it is safe (db/Frontend-Support.md), so Try again is offered. */
export function resolveFailure(status: number, body: unknown): Failure {
  if (status === 401) return { message: "Your sign-in has expired.", action: signIn };
  if (status === 404) return { message: "That question isn't yours or no longer exists.", action: { label: "Ask a question", href: "/ask" } };
  return { message: serverMessage(body) ?? "That wasn't saved. Try again.", action: null };
}

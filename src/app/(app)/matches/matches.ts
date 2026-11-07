/**
 * Match screen logic (A2 steps 1 and 2), kept apart from the screen so it
 * can be unit-tested: what a card shows, how a swipe ends, and what each
 * failed request tells the user.
 *
 * Saving rules from db/Rejections.md and db/Requests.md: one save at a
 * time, never an automatic retry of a POST (a timed-out save may have gone
 * through), and a 503 after a saved rejection says not to resubmit.
 */
import type { MatchResult } from "@/contracts/types";
import { colourHex, isBadgeColour } from "@/components/ui/badge-colours";
import { countryName, isCountryCode } from "@/components/ui/countries";

/** How far (px) a card must be dragged to count as a swipe. */
export const SWIPE_DISTANCE = 110;

export type Swipe = "pass" | "send" | null;

/** A drag's outcome: right sends, left passes, a short drag snaps back. */
export function swipeOutcome(dx: number): Swipe {
  if (dx >= SWIPE_DISTANCE) return "send";
  if (dx <= -SWIPE_DISTANCE) return "pass";
  return null;
}

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

/** The card's badge stripe colour: the person's own, sunflower when absent. */
export function cardColour(person: MatchResult["person"]): string {
  return colourHex(isBadgeColour(person.badgeColour) ? person.badgeColour : "sunflower");
}

/**
 * Hard-filter badges as people read them. Country codes become names;
 * "synthetic" is shown separately as its own label. A hidden hiring value
 * (null) is never shown as "not hiring" (db/Frontend-Support.md).
 */
export function badgeLabels(match: MatchResult): string[] {
  return match.badges
    .filter((b) => b !== "synthetic")
    .filter((b) => match.person.filters.hiring !== null || (b !== "hiring" && b !== "not hiring"))
    .map((b) => {
      if (isCountryCode(b)) return countryName(b);
      if (b === "hiring") return "Hiring";
      if (b === "not hiring") return "Not hiring";
      return b;
    });
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

/** A failed PUT /api/soft-blocker. Safe to repeat, so the user can just try again. */
export function blockerFailure(status: number, body: unknown): Failure {
  if (status === 401) return { message: "Your sign-in has expired.", action: signIn };
  if (status === 404) return { message: "That question isn't yours or no longer exists.", action: { label: "Ask a question", href: "/ask" } };
  return { message: serverMessage(body) ?? "That setting wasn't saved. Try again.", action: null };
}

const BLOCKER_KEY = "convo_soft_blocker";

function readBlockers(): Record<string, unknown> {
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(BLOCKER_KEY) ?? "{}");
    return typeof saved === "object" && saved !== null ? (saved as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * The soft blocker's last saved value for an ask, as this tab saved it, or
 * null when this tab hasn't: there's no route to read it back yet, so the
 * screen mustn't claim to know. New asks start with it on.
 */
export function recallBlocker(askId: string): boolean | null {
  const value = readBlockers()[askId];
  return typeof value === "boolean" ? value : null;
}

export function rememberBlocker(askId: string, enabled: boolean): void {
  try {
    sessionStorage.setItem(BLOCKER_KEY, JSON.stringify({ ...readBlockers(), [askId]: enabled }));
  } catch {
    // Storage unavailable: the switch shows the default next time.
  }
}

/** A failed POST /api/asks/:id/resolve. Repeating it is safe (db/Frontend-Support.md), so Try again is offered. */
export function resolveFailure(status: number, body: unknown): Failure {
  if (status === 401) return { message: "Your sign-in has expired.", action: signIn };
  if (status === 404) return { message: "That question isn't yours or no longer exists.", action: { label: "Ask a question", href: "/ask" } };
  return { message: serverMessage(body) ?? "That wasn't saved. Try again.", action: null };
}

/** A person's public GitHub profile, for the "stay in touch" prompt. */
export function githubProfile(login: string): string {
  return `https://github.com/${encodeURIComponent(login)}`;
}

export type SentTo = { id: string; name: string; githubLogin: string };

const SENT_KEY = "convo_sent";

function readSent(): Record<string, SentTo[]> {
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(SENT_KEY) ?? "{}");
    return typeof saved === "object" && saved !== null ? (saved as Record<string, SentTo[]>) : {};
  } catch {
    return {};
  }
}

/**
 * Who this tab has sent the ask to. Matching doesn't leave them out and
 * every send makes a new request, so the deck skips them on reload to
 * avoid sending the same question twice.
 */
export function recallSent(askId: string): SentTo[] {
  const list = readSent()[askId];
  return Array.isArray(list) ? list.filter((p) => p && typeof p.id === "string") : [];
}

export function rememberSent(askId: string, person: SentTo): SentTo[] {
  const next = [...recallSent(askId).filter((p) => p.id !== person.id), person];
  try {
    sessionStorage.setItem(SENT_KEY, JSON.stringify({ ...readSent(), [askId]: next }));
  } catch {
    // Storage unavailable: duplicates are still avoided until the page reloads.
  }
  return next;
}

/** The deck without people already sent this ask. */
export function withoutSent(matches: MatchResult[], sent: SentTo[]): MatchResult[] {
  const ids = new Set(sent.map((p) => p.id));
  return matches.filter((m) => !ids.has(m.person.id));
}

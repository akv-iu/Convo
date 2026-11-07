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
import { colourHex, isBadgeColour } from "../../(onboarding)/_components/badge-prefs";
import { countryName, isCountryCode } from "../../(onboarding)/onboarding/countries";

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
 * Evidence snippets as text runs, with Elasticsearch's <em> highlights
 * marked. Everything is rendered as text, never as HTML.
 */
export function highlightParts(snippet: string): { text: string; hit: boolean }[] {
  const parts: { text: string; hit: boolean }[] = [];
  snippet.split(/(<em>.*?<\/em>)/g).forEach((piece) => {
    if (!piece) return;
    const hit = piece.startsWith("<em>") && piece.endsWith("</em>");
    const text = (hit ? piece.slice(4, -5) : piece).replace(/<[^>]*>/g, "");
    if (text) parts.push({ text, hit });
  });
  return parts;
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

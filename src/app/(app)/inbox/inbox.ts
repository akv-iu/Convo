/**
 * Inbox logic (A2 step 4), kept apart from the screen for unit tests.
 *
 * Rules from db/Requests.md: only the receiver can respond; a response can
 * be changed later; a failed write may still have committed, so nothing is
 * retried automatically and the screen reloads the inbox to check.
 */
import type { CardPerson, Request, RequestStatus } from "@/contracts/types";
import { colourHex, isBadgeColour } from "../../(onboarding)/_components/badge-prefs";
import { countryName } from "../../(onboarding)/onboarding/countries";

export const REPLY_MAX = 500;

export function replyProblem(text: string): string | null {
  const t = text.trim();
  if (!t) return "Write a short reply first.";
  if (t.length > REPLY_MAX) return `Keep it under ${REPLY_MAX} characters.`;
  return null;
}

export const statusLabel: Record<RequestStatus, string> = {
  sent: "New",
  accepted: "Accepted",
  declined: "Declined",
  answered: "Replied",
  scheduled: "Meeting booked",
};

/** The same statuses from the asker's side ("You asked"). */
export const sentStatusLabel: Record<RequestStatus, string> = {
  sent: "Waiting for an answer",
  accepted: "Accepted",
  declined: "Declined",
  answered: "Replied",
  scheduled: "Meeting booked",
};

/** The short facts under a person's name. Sections they chose to hide come back null and simply aren't listed. */
export function badgeFacts(person: CardPerson): string[] {
  const facts: string[] = [];
  if (person.workplaceName) facts.push(person.workplaceName);
  if (person.filters.country) facts.push(countryName(person.filters.country));
  if (person.filters.hiring !== null) facts.push(person.filters.hiring ? "Hiring" : "Not hiring");
  return facts;
}

/** A badge's stripe colour: the person's own, sunflower when they have none (or can't be found). */
export function badgeColour(person: CardPerson | null): string {
  const colour = person?.badgeColour;
  return colourHex(isBadgeColour(colour) ? colour : "sunflower");
}

/** Venue time (Salt Lake City), so everyone at the conference sees the same clock. */
const VENUE_TZ = "America/Denver";

/** "Mon 9 Nov, 9:42 AM". */
export function venueTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: VENUE_TZ, weekday: "short", day: "numeric", month: "short" }).format(d);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: VENUE_TZ, hour: "numeric", minute: "2-digit" }).format(d);
  return `${day}, ${time}`;
}

/** "9:00 AM – 9:15 AM" in venue time. */
export function venueRange(slot: { start: string; end: string }): string {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: VENUE_TZ, hour: "numeric", minute: "2-digit" });
  return `${venueTime(slot.start)} – ${f.format(new Date(slot.end))}`;
}

export type Failure = { message: string; action: { label: string; href: string } | null };

const serverMessage = (body: unknown) =>
  typeof body === "object" && body && "error" in body && typeof body.error === "string" ? body.error : null;

/** A failed GET /api/inbox: an error, never an empty inbox. */
export function inboxFailure(status: number): Failure {
  if (status === 401) return { message: "Your sign-in has expired.", action: { label: "Sign in again", href: "/signin" } };
  return { message: "Your requests didn't load. Try again in a moment.", action: null };
}

/** A failed POST /api/requests/:id/respond. */
export function respondFailure(status: number, body: unknown): Failure {
  if (status === 401) return { message: "Your sign-in has expired.", action: { label: "Sign in again", href: "/signin" } };
  if (status === 403) return { message: "Only the person this was sent to can answer it.", action: null };
  if (status === 404) return { message: "This request no longer exists.", action: null };
  if (status === 400) return { message: "That answer wasn't accepted. Check it and try again.", action: null };
  return {
    message: serverMessage(body) ?? "Your answer may not have been saved. Reload your requests to check before trying again.",
    action: null,
  };
}

/** Newest first, as the API sends them; new ones float to the top. */
export function inboxOrder<R extends Request>(requests: R[]): R[] {
  const isNew = (r: Request) => (r.status === "sent" ? 0 : 1);
  return requests.map((r, i) => ({ r, i })).sort((a, b) => isNew(a.r) - isNew(b.r) || a.i - b.i).map(({ r }) => r);
}

/** A failed GET /api/requests/:id/slots. */
export function slotsFailure(status: number, body: unknown): Failure {
  if (status === 401) return { message: "Your sign-in has expired.", action: { label: "Sign in again", href: "/signin" } };
  if (status === 403 || status === 404) return { message: "This request is no longer yours to book.", action: null };
  return { message: serverMessage(body) ?? "Times didn't load.", action: null };
}

/** A failed POST /api/requests/:id/schedule (db/Scheduling.md). */
export function bookFailure(status: number, body: unknown): Failure {
  if (status === 401) return { message: "Your sign-in has expired.", action: { label: "Sign in again", href: "/signin" } };
  if (status === 409) return { message: "That time was just taken or is too soon. Showing what's free now.", action: null };
  if (status === 403 || status === 404) return { message: "This request is no longer yours to book.", action: null };
  return {
    message: serverMessage(body) ?? "The booking may have been saved. Reload your requests to check before booking again.",
    action: null,
  };
}

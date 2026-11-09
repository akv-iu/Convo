/**
 * Inbox logic (A2 step 4), kept apart from the screen for unit tests.
 *
 * Rules from db/Requests.md: only the receiver can respond; a response can
 * be changed later; a failed write may still have committed, so nothing is
 * retried automatically and the screen reloads the inbox to check.
 */
import type { Request, RequestStatus, RequestView } from "@/contracts/types";

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
  sent: "Sent",
  accepted: "Accepted",
  declined: "Declined",
  answered: "Replied",
  scheduled: "Meeting booked",
};

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

/** One question the asker sent, with everyone they sent it to (for "You asked"). */
export type AskGroup = {
  askId: string;
  question: string;
  minutes: number;
  /** When the newest request for it was sent. */
  latest: string;
  requests: RequestView[];
};

/**
 * "You asked", organised by question: one group per ask, newest question first, each with the
 * people it went to in the order the API sent them.
 */
export function groupByQuestion(requests: RequestView[]): AskGroup[] {
  const groups = new Map<string, AskGroup>();
  for (const r of requests) {
    const group = groups.get(r.askId);
    if (group) {
      group.requests.push(r);
      if (r.createdAt > group.latest) group.latest = r.createdAt;
    } else {
      groups.set(r.askId, { askId: r.askId, question: r.question, minutes: r.minutes, latest: r.createdAt, requests: [r] });
    }
  }
  return [...groups.values()].sort((a, b) => (a.latest < b.latest ? 1 : a.latest > b.latest ? -1 : 0));
}

const summaryWord: Record<RequestStatus, string> = {
  sent: "waiting",
  accepted: "accepted",
  declined: "declined",
  answered: "replied",
  scheduled: "meeting booked",
};

/** "3 people · 1 replied · 2 waiting": who it went to and where each stands, in a fixed order. */
export function groupSummary(requests: Pick<Request, "status">[]): string {
  return [peopleLabel(requests.length), ...groupCounts(requests).map((c) => c.text)].join(" · ");
}

/** "3 people". */
export function peopleLabel(n: number): string {
  return `${n} ${n === 1 ? "person" : "people"}`;
}

/** Each status that has requests, in groupSummary's order, with its text ("2 waiting"), for a symbol beside each. */
export function groupCounts(requests: Pick<Request, "status">[]): { status: RequestStatus; text: string }[] {
  const order: RequestStatus[] = ["scheduled", "accepted", "answered", "declined", "sent"];
  return order.flatMap((status) => {
    const n = requests.filter((r) => r.status === status).length;
    return n ? [{ status, text: `${n} ${summaryWord[status]}` }] : [];
  });
}

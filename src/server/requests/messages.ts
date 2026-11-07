import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../../../db";
import { asks, requests, users } from "../../../db/schema";
import { Person, RefinedAsk, Request, type CardPerson, type ProfileVisibility, type RequestView } from "@/contracts/types";
import type { RouteBody } from "@/contracts/routes";
import { toPerson } from "@/server/profile/service";
import { visiblePerson } from "@/server/profile/visibility";
import { search } from "@/server/search";

class RequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

function toRequest(row: typeof requests.$inferSelect): Request {
  return Request.parse({ ...row, createdAt: row.createdAt.toISOString() });
}

const HIDE_ALL: ProfileVisibility = { country: false, workplace: false, hiring: false };

/**
 * Requests as one side sees them: the other person's badge (their show/hide choices applied) and the
 * ask's type. Two batched database reads, plus one batched search read for people without an account.
 */
async function withBadges(rows: Request[], other: (request: Request) => string): Promise<RequestView[]> {
  if (!rows.length) return [];
  const ids = [...new Set(rows.map(other))];
  const [accounts, asked] = await Promise.all([
    db().select().from(users).where(inArray(users.id, ids)),
    db().select({ id: asks.id, refined: asks.refined }).from(asks).where(inArray(asks.id, [...new Set(rows.map((r) => r.askId))])),
  ]);
  const people = new Map<string, CardPerson>();
  for (const user of accounts) {
    if (user.filters === null) continue;
    const person = toPerson(user);
    people.set(person.id, visiblePerson(person));
  }
  // Synthetic people exist only in search. A search copy of a real account never decides what's shown.
  const withoutAccount = ids.filter((id) => !accounts.some((user) => user.id === id));
  for (const person of await search.getPeople(withoutAccount)) {
    people.set(person.id, visiblePerson(person, person.synthetic ? person.visibility : HIDE_ALL));
  }
  const types = new Map(asked.map((ask) => [ask.id, RefinedAsk.safeParse(ask.refined).data?.type ?? null]));
  return rows.map((r) => ({ ...r, type: types.get(r.askId) ?? null, person: people.get(other(r)) ?? null }));
}

export async function sendRequest(userId: string, body: RouteBody<"sendRequest">): Promise<Request> {
  let ask: { rawText: string; refined: RefinedAsk | null } | undefined;
  try {
    [ask] = await db().select({ rawText: asks.rawText, refined: asks.refined }).from(asks)
      .where(and(eq(asks.id, body.askId), eq(asks.userId, userId))).limit(1);
  } catch {
    throw new RequestError("Ask storage is unavailable. Try again.", 503);
  }
  if (!ask) throw new RequestError("Ask not found.", 404);

  let recipientExists: boolean;
  try {
    const [user] = await db().select({ id: users.id }).from(users).where(eq(users.id, body.toPersonId)).limit(1);
    recipientExists = Boolean(user);
    if (!recipientExists) {
      const person = await search.getPerson(body.toPersonId);
      if (person !== undefined) {
        if (Person.parse(person).id !== body.toPersonId) throw new Error("Recipient ID mismatch");
        recipientExists = true;
      }
    }
  } catch {
    throw new RequestError("Recipient lookup is unavailable. No request was sent.", 503);
  }
  if (!recipientExists) throw new RequestError("Person not found.", 404);

  let value: Request;
  try {
    const refined = ask.refined === null ? null : RefinedAsk.parse(ask.refined);
    value = Request.parse({
      id: randomUUID(), askId: body.askId, fromUserId: userId, toPersonId: body.toPersonId,
      question: refined?.text ?? ask.rawText, minutes: refined?.minutes ?? 10,
      status: "sent", reply: null, slot: null, createdAt: new Date().toISOString(),
    });
  } catch {
    throw new RequestError("Stored ask is invalid. No request was sent.", 503);
  }
  let saved: typeof requests.$inferSelect | undefined;
  try {
    // One request per person per ask (unique ask/recipient): a resend or a retry after a timeout
    // returns the request already saved, never a duplicate in the receiver's inbox.
    [saved] = await db().insert(requests).values({ ...value, createdAt: new Date(value.createdAt) })
      .onConflictDoNothing({ target: [requests.askId, requests.toPersonId] }).returning();
    // The ask is the caller's (checked above), so an existing request for it is theirs too.
    saved ??= (await db().select().from(requests)
      .where(and(eq(requests.askId, body.askId), eq(requests.toPersonId, body.toPersonId))).limit(1))[0];
  } catch {
    saved = undefined;
  }
  if (!saved) throw new RequestError("Request save could not be confirmed. Retrying is safe: a saved request is returned, never sent twice.", 503);
  try {
    return toRequest(saved);
  } catch {
    throw new RequestError("Stored request is invalid.", 503);
  }
}

export async function getInbox(userId: string): Promise<RequestView[]> {
  try {
    const rows = await db().select().from(requests).where(eq(requests.toPersonId, userId))
      .orderBy(desc(requests.createdAt), desc(requests.id));
    return await withBadges(rows.map(toRequest), (request) => request.fromUserId);
  } catch {
    throw new RequestError("Inbox storage is unavailable. Try again.", 503);
  }
}

/** What the asker needs to see after sending: each receiver's badge, status, reply and booked time. */
export async function getSentRequests(userId: string): Promise<RequestView[]> {
  try {
    const rows = await db().select().from(requests).where(eq(requests.fromUserId, userId))
      .orderBy(desc(requests.createdAt), desc(requests.id));
    return await withBadges(rows.map(toRequest), (request) => request.toPersonId);
  } catch {
    throw new RequestError("Sent requests are unavailable. Try again.", 503);
  }
}

export async function respondToRequest(userId: string, id: string, body: RouteBody<"respond">): Promise<Request> {
  try {
    // Update only the response fields; concurrent responses must not overwrite a booked slot.
    const changes = body.action === "reply"
      ? { status: "answered" as const, reply: body.reply }
      : { status: body.action === "accept" ? "accepted" as const : "declined" as const };
    const [updated] = await db().update(requests).set(changes)
      .where(and(eq(requests.id, id), eq(requests.toPersonId, userId))).returning();
    if (updated) return toRequest(updated);
  } catch {
    throw new RequestError("Response storage is unavailable. The save could not be confirmed; refresh your inbox before retrying.", 503);
  }

  let exists: { id: string }[];
  try {
    exists = await db().select({ id: requests.id }).from(requests).where(eq(requests.id, id)).limit(1);
  } catch {
    throw new RequestError("Request storage is unavailable. Try again.", 503);
  }
  if (!exists.length) throw new RequestError("Request not found.", 404);
  throw new RequestError("Not the receiver.", 403);
}

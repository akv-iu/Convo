import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../../../db";
import { asks, requests, users } from "../../../db/schema";
import { Person, RefinedAsk, Request } from "@/contracts/types";
import type { RouteBody } from "@/contracts/routes";
import { search } from "@/server/search";

class RequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

function toRequest(row: typeof requests.$inferSelect): Request {
  return Request.parse({ ...row, createdAt: row.createdAt.toISOString() });
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
  try {
    // shortcut: repeated sends create separate requests; add idempotency with a shared contract change.
    const [saved] = await db().insert(requests).values({ ...value, createdAt: new Date(value.createdAt) }).returning();
    return toRequest(saved);
  } catch {
    throw new RequestError(`Request save could not be confirmed (ID ${value.id}). Ask the receiver to check their inbox before retrying.`, 503);
  }
}

export async function getInbox(userId: string): Promise<Request[]> {
  try {
    const rows = await db().select().from(requests).where(eq(requests.toPersonId, userId))
      .orderBy(desc(requests.createdAt), desc(requests.id));
    return rows.map(toRequest);
  } catch {
    throw new RequestError("Inbox storage is unavailable. Try again.", 503);
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

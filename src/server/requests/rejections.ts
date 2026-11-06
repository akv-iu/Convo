import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../../db";
import { asks, rejections } from "../../../db/schema";
import { routes, type RouteBody, type RouteResponse } from "@/contracts/routes";
import { config } from "@/server/config";

class RejectionError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

// Call only after an owner-scoped ask read or write.
export async function getExclusions(askId: string) {
  try {
    const rows = await db().select({ personId: rejections.personId, rank: rejections.rank })
      .from(rejections).where(eq(rejections.askId, askId));
    const rejected = routes.reject.body.omit({ askId: true }).array().parse(rows);
    return {
      excludeIds: rejected.map(({ personId }) => personId),
      rejections: rejected.length,
      hiddenBelowRank: rejected.length >= config.batchRejectAfter
        ? rejected.reduce((highest, rejection) => Math.max(highest, rejection.rank), 0) : null,
    };
  } catch {
    throw new RejectionError("Ask exclusions are unavailable. Try again.", 503);
  }
}

export async function rejectPerson(userId: string, body: RouteBody<"reject">): Promise<RouteResponse<"reject">> {
  // shortcut: retries count again; add idempotency when the shared contract supports it.
  let inserted: { id: string }[];
  try {
    // Authorize inside the write so a foreign ask can never acquire this rejection.
    inserted = await db().insert(rejections).select(db().select({
      id: sql<string>`${randomUUID()}`.as("id"), askId: asks.id,
      personId: sql<string>`${body.personId}`.as("person_id"), rank: sql<number>`${body.rank}`.as("rank"),
      createdAt: sql<Date>`now()`.as("created_at"),
    }).from(asks).where(and(eq(asks.id, body.askId), eq(asks.userId, userId))))
      .returning({ id: rejections.id });
  } catch {
    throw new RejectionError("Rejection storage is unavailable. The save could not be confirmed; refresh matches before retrying.", 503);
  }
  if (!inserted.length) throw new RejectionError("Ask not found.", 404);
  try {
    const { rejections: count, hiddenBelowRank } = await getExclusions(body.askId);
    return { rejections: count, hiddenBelowRank };
  } catch {
    throw new RejectionError("Rejection saved, but its count is unavailable. Refresh matches; do not resubmit this rejection.", 503);
  }
}

export async function setSoftBlocker(userId: string, body: RouteBody<"setSoftBlocker">): Promise<RouteResponse<"setSoftBlocker">> {
  let updated: RouteResponse<"setSoftBlocker">[];
  try {
    updated = await db().update(asks).set({ softBlocker: body.enabled })
      .where(and(eq(asks.id, body.askId), eq(asks.userId, userId)))
      .returning({ askId: asks.id, enabled: asks.softBlocker });
  } catch {
    throw new RejectionError("Soft blocker storage is unavailable. The save could not be confirmed; retry the same setting.", 503);
  }
  if (!updated.length) throw new RejectionError("Ask not found.", 404);
  return updated[0];
}

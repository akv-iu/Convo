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
  let inserted: { id: string }[];
  try {
    // Authorize inside the write so a foreign ask can never acquire this rejection. A repeat for the
    // same person inserts nothing (unique ask/person), so a retry or double tap is never counted twice.
    inserted = await db().insert(rejections).select(db().select({
      id: sql<string>`${randomUUID()}`.as("id"), askId: asks.id,
      personId: sql<string>`${body.personId}`.as("person_id"), rank: sql<number>`${body.rank}`.as("rank"),
      createdAt: sql<Date>`now()`.as("created_at"),
    }).from(asks).where(and(eq(asks.id, body.askId), eq(asks.userId, userId))))
      .onConflictDoNothing({ target: [rejections.askId, rejections.personId] })
      .returning({ id: rejections.id });
  } catch {
    throw new RejectionError("Rejection storage is unavailable. The save could not be confirmed; retrying the same rejection is safe.", 503);
  }
  // Nothing inserted: either this person was already rejected for the ask, or the ask isn't the caller's.
  if (!inserted.length && !await ownsAsk(userId, body.askId)) throw new RejectionError("Ask not found.", 404);
  try {
    const { rejections: count, hiddenBelowRank } = await getExclusions(body.askId);
    return { rejections: count, hiddenBelowRank };
  } catch {
    throw new RejectionError("Rejection saved, but its count is unavailable. Refresh matches; retrying is safe and never counts twice.", 503);
  }
}

async function ownsAsk(userId: string, askId: string): Promise<boolean> {
  try {
    const rows = await db().select({ id: asks.id }).from(asks)
      .where(and(eq(asks.id, askId), eq(asks.userId, userId))).limit(1);
    return rows.length > 0;
  } catch {
    throw new RejectionError("Rejection storage is unavailable. Try again; retrying the same rejection is safe.", 503);
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

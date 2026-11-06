import { and, eq, inArray, isNotNull, isNull, ne, notExists, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../../../db";
import { requests, users } from "../../../db/schema";
import { Request, Slot, TimeBlock } from "@/contracts/types";
import { config } from "@/server/config";
import { search } from "@/server/search";
import { findSlots } from "./slots";

class ScheduleError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function readRequest(userId: string, id: string): Promise<Request> {
  let row: typeof requests.$inferSelect | undefined;
  try {
    [row] = await db().select().from(requests).where(eq(requests.id, id)).limit(1);
  } catch {
    throw new ScheduleError("Request storage is unavailable. Try again.", 503);
  }
  if (!row) throw new ScheduleError("Request not found.", 404);
  if (row.fromUserId !== userId && row.toPersonId !== userId) throw new ScheduleError("Not your request.", 403);
  try {
    return Request.parse({ ...row, createdAt: row.createdAt.toISOString() });
  } catch {
    throw new ScheduleError("Stored request is invalid.", 503);
  }
}

function times(value: unknown): TimeBlock[] {
  const result = TimeBlock.array().parse(value);
  if (result.some(t => Date.parse(t.end) <= Date.parse(t.start))) throw new Error("Invalid interval");
  return result;
}

async function availability(ids: string[]) {
  try {
    const rows = await db().select({ id: users.id, freeTimes: users.freeTimes, revision: users.revision })
      .from(users).where(inArray(users.id, ids));
    const missing = ids.filter(id => !rows.some(row => row.id === id));
    const external = missing.length ? await search.getAvailability(missing) : {};
    const free = Object.fromEntries(ids.map(id => [id, times(rows.find(row => row.id === id)?.freeTimes ?? external[id] ?? [])]));
    return { free, rows, missing };
  } catch {
    throw new ScheduleError("Availability is unavailable. Try again.", 503);
  }
}

export async function getSlots(userId: string, id: string): Promise<Slot[]> {
  const request = await readRequest(userId, id);
  if (request.slot !== null || request.status !== "accepted") return [];
  const ids = [...new Set([request.fromUserId, request.toPersonId])];
  const { free } = await availability(ids);
  try {
    // A saved slot stays reserved even if a later response changes the request status.
    const booked = await db().select({ slot: requests.slot }).from(requests).where(and(
      isNotNull(requests.slot), or(inArray(requests.fromUserId, ids), inArray(requests.toPersonId, ids)),
    ));
    return findSlots(free[request.fromUserId], free[request.toPersonId], {
      // Leave a minute to select a suggestion before the strict booking cutoff catches it.
      now: new Date(), minutes: request.minutes, lockoutMinutes: config.slotLockoutMinutes + 1,
      max: config.maxSlots, booked: times(booked.map(row => row.slot)),
    });
  } catch {
    throw new ScheduleError("Booked times are unavailable. Try again.", 503);
  }
}

export async function bookSlot(userId: string, id: string, slot: Slot): Promise<Request> {
  const request = await readRequest(userId, id);
  const start = Date.parse(slot.start), end = Date.parse(slot.end);
  if (request.slot !== null) {
    if (request.status === "scheduled" && Date.parse(request.slot.start) === start && Date.parse(request.slot.end) === end) return request;
    throw new ScheduleError("This request already has a booking. Refresh your inbox.", 409);
  }
  if (request.status !== "accepted") throw new ScheduleError("The receiver must accept before booking.", 409);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end - start !== request.minutes * 60_000) {
    throw new ScheduleError("The slot must match the requested meeting length.", 400);
  }
  if (start < Date.now() + config.slotLockoutMinutes * 60_000) {
    throw new ScheduleError("The slot must start at least one hour from now. Refresh available slots.", 409);
  }
  const ids = [...new Set([request.fromUserId, request.toPersonId])];
  const { free, rows, missing } = await availability(ids);
  const fit = findSlots(free[request.fromUserId], free[request.toPersonId], {
    now: new Date(start), minutes: request.minutes, lockoutMinutes: 0, max: 1,
  })[0];
  if (!fit || Date.parse(fit.start) !== start) throw new ScheduleError("This time is outside the shared availability. Refresh available slots.", 409);

  const normalized = { start: new Date(start).toISOString(), end: new Date(end).toISOString() };
  const other = alias(requests, "other_booking");
  const statement = db().update(requests).set({ status: "scheduled", slot: normalized }).where(and(
    eq(requests.id, id), or(eq(requests.fromUserId, userId), eq(requests.toPersonId, userId)),
    eq(requests.fromUserId, request.fromUserId), eq(requests.toPersonId, request.toPersonId),
    eq(requests.status, "accepted"), isNull(requests.slot), eq(requests.minutes, request.minutes),
    sql`${normalized.start}::timestamptz >= statement_timestamp() + ${config.slotLockoutMinutes} * interval '1 minute'`,
    ...rows.map(row => sql`exists (select 1 from ${users} where ${users.id} = ${row.id} and ${users.revision} = ${row.revision})`),
    missing.length ? notExists(db().select({ id: users.id }).from(users).where(inArray(users.id, missing))) : undefined,
    notExists(db().select({ id: other.id }).from(other).where(and(
      ne(other.id, id), isNotNull(other.slot), or(inArray(other.fromUserId, ids), inArray(other.toPersonId, ids)),
      sql`(${other.slot}->>'start')::timestamptz < ${normalized.end}::timestamptz`,
      sql`(${other.slot}->>'end')::timestamptz > ${normalized.start}::timestamptz`,
    ))),
  )).returning({ saved: sql<Request>`jsonb_build_object(
    'id', ${requests.id}, 'askId', ${requests.askId}, 'fromUserId', ${requests.fromUserId}, 'toPersonId', ${requests.toPersonId},
    'question', ${requests.question}, 'minutes', ${requests.minutes}, 'status', ${requests.status},
    'reply', ${requests.reply}, 'slot', ${requests.slot}, 'createdAt', ${requests.createdAt})`.as("saved") }).toSQL();

  let returned: Record<string, unknown> | undefined;
  try {
    // Serializable prevents two different request rows from both passing the overlap check.
    const [result] = await db().$client.transaction(tx => [tx.query(statement.sql, statement.params)], {
      isolationLevel: "Serializable", arrayMode: false, fullResults: false,
    });
    returned = result[0];
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "40001") {
      throw new ScheduleError("Another booking changed these times. Refresh available slots.", 409);
    }
    throw new ScheduleError("Booking save could not be confirmed. Check your inbox before retrying the same slot.", 503);
  }
  if (!returned) throw new ScheduleError("Availability or request state changed. Refresh your inbox and available slots.", 409);
  try {
    const parsed = Request.parse(returned.saved);
    return { ...parsed, createdAt: new Date(parsed.createdAt).toISOString() };
  } catch {
    throw new ScheduleError("Booking saved, but its response is unavailable. Refresh your inbox.", 503);
  }
}

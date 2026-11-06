import { eq, sql } from "drizzle-orm";
import { db } from "../../../db";
import { users } from "../../../db/schema";
import { routes, type RouteBody } from "@/contracts/routes";
import { Person, type TimeBlock } from "@/contracts/types";
import { search } from "@/server/search";

type User = typeof users.$inferSelect;
type ProfilePatch = RouteBody<"putMe">;

class ProfileError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function readUser(userId: string): Promise<User> {
  let rows: User[];
  try {
    rows = await db().select().from(users).where(eq(users.id, userId)).limit(1);
  } catch {
    throw new ProfileError("Profile storage is unavailable. Try again.", 503);
  }
  if (!rows[0]) throw new ProfileError("Profile not found. Sign in again.", 404);
  return rows[0];
}

async function writeUser(userId: string, changes: ProfilePatch): Promise<User> {
  let rows: User[];
  try {
    rows = await db().update(users).set({
      ...changes,
      // Older clients changing the ROR ID must not retain the previous workplace's label.
      ...(changes.filters && changes.workplaceName === undefined ? {
        workplaceName: sql`case when ${users.filters}->>'rorId' is distinct from ${changes.filters.rorId}::text then null else ${users.workplaceName} end`,
      } : {}),
      revision: sql`${users.revision} + 1`,
    })
      .where(eq(users.id, userId)).returning();
  } catch {
    throw new ProfileError("Profile storage is unavailable. Try again.", 503);
  }
  if (!rows[0]) throw new ProfileError("Profile not found. Sign in again.", 404);
  return rows[0];
}

function toPerson(user: User): Person {
  if (user.filters === null) throw new ProfileError("Complete onboarding first: save country, workplace and hiring answers.", 409);
  const parsed = Person.safeParse({ ...user, synthetic: false });
  if (!parsed.success) throw new ProfileError("Stored profile is invalid.", 503);
  return parsed.data;
}

function validateTimes(times: TimeBlock[]): void {
  if (times.some(({ start, end }) => !(Date.parse(end) > Date.parse(start)))) {
    throw new ProfileError("Each availability interval must end after it starts.", 400);
  }
}

async function syncProfile(person: Person, revision: number): Promise<void> {
  try {
    await search.ingestPerson(person, undefined, revision);
  } catch {
    // Postgres is already saved. An identical retry can repair search without losing data.
    throw new ProfileError("Profile saved, but search update failed. Retry the same save.", 503);
  }
}

export async function getProfile(userId: string): Promise<Person> {
  return toPerson(await readUser(userId));
}

export async function updateProfile(userId: string, changes: ProfilePatch): Promise<Person> {
  if (changes.freeTimes) validateTimes(changes.freeTimes);
  const existing = await readUser(userId);
  toPerson({ ...existing, ...changes }); // Validate onboarding before writing any fields.
  const saved = Object.values(changes).some((value) => value !== undefined)
    ? await writeUser(userId, changes) : existing;
  const person = toPerson(saved);
  await syncProfile(person, saved.revision);
  return person;
}

export async function getAvailability(userId: string): Promise<TimeBlock[]> {
  const user = await readUser(userId);
  const parsed = routes.getAvailability.response.safeParse(user.freeTimes);
  if (!parsed.success) throw new ProfileError("Stored availability is invalid.", 503);
  return parsed.data;
}

export async function saveAvailability(userId: string, times: TimeBlock[]): Promise<TimeBlock[]> {
  validateTimes(times);
  const saved = await writeUser(userId, { freeTimes: times });
  if (saved.filters !== null) await syncProfile(toPerson(saved), saved.revision);
  return saved.freeTimes;
}

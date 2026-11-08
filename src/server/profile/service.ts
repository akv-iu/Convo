import { and, eq, sql } from "drizzle-orm";
import { db } from "../../../db";
import { users } from "../../../db/schema";
import { routes, type RouteBody } from "@/contracts/routes";
import { EvidenceDoc, Person, type TimeBlock } from "@/contracts/types";
import { search, type SearchService } from "@/server/search";
import { MAX_REPO_EVIDENCE } from "./index";

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

export function toPerson(user: User): Person {
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

/** `target` lets the seed write to Elasticsearch whatever the app's search switch says. */
export async function syncProfile(user: User, target: SearchService = search): Promise<Person> {
  const person = toPerson(user);
  const evidence = EvidenceDoc.array().max(MAX_REPO_EVIDENCE).safeParse(user.githubEvidence);
  if (!evidence.success || evidence.data.some(doc => doc.personId !== user.id || doc.kind !== "repo")) {
    throw new ProfileError("Saved repository evidence is invalid. Sign in again to refresh it.", 503);
  }
  try {
    await target.ingestPerson(person, evidence.data, user.revision);
    if (user.githubEvidencePending) {
      // Only this exact snapshot can confirm that stale repository evidence was replaced.
      await db().update(users).set({ githubEvidencePending: false })
        .where(and(eq(users.id, user.id), eq(users.revision, user.revision)));
    }
  } catch {
    // Postgres is already saved. An identical retry can repair search without losing data.
    // shortcut: retries require a sign-in/save; add a worker when unattended recovery is needed.
    throw new ProfileError("Profile saved, but search synchronization could not be confirmed. Retry the same save or sign in again.", 503);
  }
  return person;
}

export async function getProfile(userId: string): Promise<Person> {
  return toPerson(await readUser(userId));
}

export async function updateProfile(userId: string, changes: ProfilePatch): Promise<Person> {
  changes = routes.putMe.body.parse(changes); // Server-owned identity fields never reach a write.
  if (changes.freeTimes) validateTimes(changes.freeTimes);
  const existing = await readUser(userId);
  toPerson({ ...existing, ...changes }); // Validate onboarding before writing any fields.
  const saved = Object.values(changes).some((value) => value !== undefined)
    ? await writeUser(userId, changes) : existing;
  return syncProfile(saved);
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
  if (saved.filters !== null) await syncProfile(saved);
  return saved.freeTimes;
}

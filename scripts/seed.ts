/**
 * Load everything searchable into Elasticsearch through the same ingestion path
 * real sign-ups use (B1): the fixture people, the 500 synthetic attendees, every
 * signed-up user who finished onboarding (with all approved evidence saved in
 * Postgres), and every open ask. Safe to re-run: newer saves win. Failed users
 * are reported by ID; other users, open asks and the final refresh still run.
 * Run from the repo root, after `es/rebuild.ts` when the indices are new:
 *   npm run seed
 */
import { readFile } from "node:fs/promises";
import { eq, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { evidence, people } from "@/contracts/fixtures";
import { EvidenceDoc, Person } from "@/contracts/types";
import { syncProfile } from "@/server/profile/service";
import { askDocument, client, elasticSearch, INDEX } from "@/server/search/elastic";
import { db } from "../db";
import { asks, users } from "../db/schema";

const SYNTHETIC = "scripts/synthetic/people.json";
const PARALLEL = 8;

/** A few at a time: each ingest waits for a refresh (about a second), so one by one takes minutes for 500. */
async function eachInParallel<T>(items: readonly T[], ingest: (item: T) => Promise<unknown>): Promise<void> {
  let next = 0;
  let failed = false;
  const worker = async (): Promise<void> => {
    if (failed || next >= items.length) return;
    try {
      await ingest(items[next++]);
    } catch (error) {
      failed = true; // the other workers start nothing new, and the seed fails with this error
      throw error;
    }
    return worker();
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, items.length) }, worker));
}

export async function seedSynthetic(): Promise<number> {
  const file = z.object({ people: Person.array(), evidence: EvidenceDoc.array() })
    .parse(JSON.parse(await readFile(SYNTHETIC, "utf8")));
  const docs = new Map<string, EvidenceDoc[]>();
  for (const doc of file.evidence) docs.set(doc.personId, [...(docs.get(doc.personId) ?? []), doc]);
  await eachInParallel(file.people, (person) => elasticSearch.ingestPerson(person, docs.get(person.id) ?? []));
  return file.people.length;
}

export async function seedUsers(): Promise<{ indexed: number; failed: string[] }> {
  // syncProfile replays all approved evidence and expertise at the saved revision. It writes
  // straight to Elasticsearch, like the rest of this script: the app's search switch (FAKE_API=1 in
  // .env.local) would send users to throwaway memory and still clear their pending flag.
  const onboarded = await db().select().from(users).where(isNotNull(users.filters));
  const failed: string[] = [];
  await eachInParallel(onboarded, async (user) => {
    try { await syncProfile(user, elasticSearch); }
    catch { failed.push(user.id); }
  });
  return { indexed: onboarded.length - failed.length, failed: failed.sort((a, b) => a.localeCompare(b, "en")) };
}

async function seedAsks(): Promise<number> {
  const open = await db().select({ id: asks.id, userId: asks.userId, refined: asks.refined }).from(asks).where(eq(asks.status, "open"));
  // One bulk call; `create` keeps registration once-only (409 = already registered or resolved).
  const operations = open.flatMap((ask) => ask.refined
    ? [{ create: { _index: INDEX.asks, _id: ask.id } }, askDocument(ask.id, ask.userId, ask.refined.text)]
    : []);
  if (operations.length) {
    const result = await client().bulk({ operations });
    const failed = result.items.map((item) => item.create).find((item) => item && item.status >= 300 && item.status !== 409);
    if (failed) throw new Error(`Ask indexing failed: ${failed.error?.reason ?? "unknown error"}`);
  }
  return open.filter((ask) => ask.refined).length;
}

export async function seed() {
  let failed: string[] = [];
  await eachInParallel(people, (person) => elasticSearch.ingestPerson(person, evidence.filter((e) => e.personId === person.id)));
  console.log(`ingested ${people.length} fixture people`);
  console.log(`ingested ${await seedSynthetic()} synthetic attendees`);
  if (process.env.DATABASE_URL) {
    const result = await seedUsers();
    failed = result.failed;
    console.log(`ingested ${result.indexed} signed-up users`);
    if (failed.length) console.error("Signed-up users could not be indexed", { count: failed.length, ids: failed });
    console.log(`registered ${await seedAsks()} open asks`);
  } else {
    console.log("DATABASE_URL not set: skipped signed-up users and open asks");
  }
  await client().indices.refresh({ index: [INDEX.people, INDEX.evidence, INDEX.asks] });
  if (failed.length) throw new Error("User seeding incomplete.");
}

// Only when run as a script (`npm run seed`), so the tests can import the loaders without seeding anything.
if (process.argv[1]?.endsWith("seed.ts")) {
  seed().catch(() => {
    // Provider errors can contain profile text or credentials.
    console.error("Seeding failed. Check the failure summary and service configuration.");
    process.exitCode = 1;
  });
}

/**
 * Load everything searchable into Elasticsearch through the same ingestion path
 * real sign-ups use (B1): the fixture people, the 500 synthetic attendees, every
 * signed-up user who finished onboarding, and every open ask. Each user comes back
 * from their saved Postgres row: approved evidence from every source (GitHub,
 * research, public profile, CV excerpts), expertise and revision. Safe to re-run:
 * newer saves win. A user who can't be indexed doesn't stop the others; the run
 * lists them and exits non-zero, and their saved profile is untouched.
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

/**
 * Replays every onboarded user's saved row through syncProfile, the same path as a profile save: their
 * approved evidence snapshot (or, before their first approval, legacy GitHub evidence), expertise and
 * revision. Only the public users row is read, never private enrichment input. It writes straight to
 * Elasticsearch, like the rest of this script: the app's search switch (FAKE_API=1 in .env.local) would
 * send users to throwaway memory and still clear their pending flag.
 *
 * One failure (an invalid stored snapshot, an index error) must not leave everyone after it missing from
 * a rebuilt index, so the others still run. Failures are returned as "<user id>: <message>"; the messages
 * are fixed sanitized texts, never profile content. A failed user's row and pending flag stay as they were.
 */
export async function seedUsers(): Promise<{ indexed: number; failed: string[] }> {
  const onboarded = await db().select().from(users).where(isNotNull(users.filters));
  const failed: string[] = [];
  await eachInParallel(onboarded, (user) => syncProfile(user, elasticSearch).catch((error: unknown) => {
    failed.push(`${user.id}: ${error instanceof Error ? error.message : "unknown error"}`);
  }));
  return { indexed: onboarded.length - failed.length, failed };
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

async function main() {
  await eachInParallel(people, (person) => elasticSearch.ingestPerson(person, evidence.filter((e) => e.personId === person.id)));
  console.log(`ingested ${people.length} fixture people`);
  console.log(`ingested ${await seedSynthetic()} synthetic attendees`);
  if (process.env.DATABASE_URL) {
    const { indexed, failed } = await seedUsers();
    console.log(`ingested ${indexed} signed-up users`);
    if (failed.length) {
      // Listed now, so a later failure can't hide them; open asks still load, then the run exits non-zero.
      console.error(`${failed.length} signed-up users could not be indexed; their saved profiles are unchanged. Fix and re-run:`);
      for (const line of failed) console.error(`  ${line}`);
      process.exitCode = 1;
    }
    console.log(`registered ${await seedAsks()} open asks`);
  } else {
    console.log("DATABASE_URL not set: skipped signed-up users and open asks");
  }
  await client().indices.refresh({ index: [INDEX.people, INDEX.evidence, INDEX.asks] });
}

// Only when run as a script (`npm run seed`), so the tests can import the loaders without seeding anything.
if (process.argv[1]?.endsWith("seed.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

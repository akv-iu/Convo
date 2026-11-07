/**
 * Load everything searchable into Elasticsearch through the same ingestion path
 * real sign-ups use (B1): the fixture people, the 500 synthetic attendees, every
 * signed-up user who finished onboarding (with the GitHub evidence saved in
 * Postgres), and every open ask. Safe to re-run: newer saves win.
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
  const worker = async (): Promise<void> => {
    if (next >= items.length) return;
    await ingest(items[next++]);
    return worker();
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, items.length) }, worker));
}

async function seedSynthetic(): Promise<number> {
  const file = z.object({ people: Person.array(), evidence: EvidenceDoc.array() })
    .parse(JSON.parse(await readFile(SYNTHETIC, "utf8")));
  const docs = new Map<string, EvidenceDoc[]>();
  for (const doc of file.evidence) docs.set(doc.personId, [...(docs.get(doc.personId) ?? []), doc]);
  await eachInParallel(file.people, (person) => elasticSearch.ingestPerson(person, docs.get(person.id) ?? []));
  return file.people.length;
}

async function seedUsers(): Promise<number> {
  // syncProfile ingests the GitHub evidence saved in Postgres, so a rebuilt index gets it back.
  const onboarded = await db().select().from(users).where(isNotNull(users.filters));
  await eachInParallel(onboarded, syncProfile);
  return onboarded.length;
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
    console.log(`ingested ${await seedUsers()} signed-up users`);
    console.log(`registered ${await seedAsks()} open asks`);
  } else {
    console.log("DATABASE_URL not set: skipped signed-up users and open asks");
  }
  await client().indices.refresh({ index: [INDEX.people, INDEX.evidence, INDEX.asks] });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

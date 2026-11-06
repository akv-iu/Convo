/**
 * Load everything searchable into Elasticsearch through the same ingestion path
 * real sign-ups use (B1): the fixture people, every signed-up user who finished
 * onboarding, and every open ask from Postgres. Safe to re-run: newer saves win.
 * Run after `es/rebuild.ts`:
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/seed.ts
 */
import { eq } from "drizzle-orm";
import { evidence, people } from "@/contracts/fixtures";
import { getProfile } from "@/server/profile/service";
import { askDocument, client, elasticSearch, INDEX } from "@/server/search/elastic";
import { db } from "../db";
import { asks, users } from "../db/schema";

async function seedUsers(): Promise<number> {
  const rows = await db().select({ id: users.id, revision: users.revision }).from(users);
  let loaded = 0;
  for (const { id, revision } of rows) {
    const person = await getProfile(id).catch((error: { status?: number }) => {
      if (error.status === 409) return undefined; // onboarding not finished yet: nothing to search
      throw error;
    });
    if (person) {
      await elasticSearch.ingestPerson(person, undefined, revision);
      loaded += 1;
    }
  }
  return loaded;
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
  // One person at a time: each ingest is several Elasticsearch calls, and Phase 3 adds 500 people.
  for (const person of people) {
    await elasticSearch.ingestPerson(person, evidence.filter((e) => e.personId === person.id));
  }
  console.log(`ingested ${people.length} fixture people`);
  if (process.env.DATABASE_URL) {
    console.log(`ingested ${await seedUsers()} signed-up users`);
    console.log(`registered ${await seedAsks()} open asks`);
  } else {
    console.log("DATABASE_URL not set: skipped signed-up users and open asks");
  }
  await client().indices.refresh({ index: [INDEX.people, INDEX.evidence, INDEX.asks] });
  // TODO (B1, Phase 3): generate 500 synthetic people with evidence and free times, labelled synthetic, and ingest them here.
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * Load the fixtures (and later the 500 generated profiles) through the same
 * ingestion path real sign-ups use (B1).
 *   npm run seed
 */
import { evidence, people } from "@/contracts/fixtures";
import { search } from "@/server/search";

async function main() {
  for (const person of people) {
    await search.ingestPerson(
      person,
      evidence.filter((e) => e.personId === person.id),
    );
    console.log(`ingested ${person.id} ${person.name}`);
  }
  // TODO (B1): generate 500 synthetic people + evidence with an LLM, label synthetic: true, ingest them here.
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

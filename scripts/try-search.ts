/**
 * Ask the search service a question from the command line and time it.
 *   npm run try-search -- "scheduler preemption"
 *   FAKES=search npm run try-search -- "job at grafana"
 */
import { search } from "@/server/search";

async function main() {
  const query = process.argv.slice(2).join(" ") || "scheduler preemption";
  const started = performance.now();
  const results = await search.searchCandidates(query, { excludeIds: [] });
  const ms = Math.round(performance.now() - started);
  console.log(`${results.length} people for "${query}" in ${ms} ms`);
  for (const r of results) {
    console.log(`- ${r.person.name} (${r.score.toFixed(1)}) ${r.highlights.join(" | ")}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

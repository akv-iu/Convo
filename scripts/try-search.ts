/**
 * Ask the search service a question from the command line and time it (B1).
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/try-search.ts "scheduler preemption"
 *   ... scripts/try-search.ts --samples   checks each fixture sample ask finds its expected person first
 * Uses Elasticsearch unless FAKES includes "search".
 */
import { DEMO_USER_A, sampleAsks } from "@/contracts/fixtures";
import { config } from "@/server/config";
import { elasticSearch } from "@/server/search/elastic";
import { memorySearch } from "@/server/search/memory";

const search = config.fakeSearch ? memorySearch : elasticSearch;

async function timed(query: string, excludeIds: string[] = []) {
  const started = performance.now();
  const results = await search.searchCandidates(query, { excludeIds });
  return { results, ms: Math.round(performance.now() - started) };
}

async function samples(): Promise<boolean> {
  let passed = 0;
  for (const sample of sampleAsks) {
    const { results, ms } = await timed(sample.raw, [DEMO_USER_A]); // sequential, so each timing stands alone
    const top = results[0]?.person.id;
    const ok = top === sample.expectedTop;
    if (ok) passed += 1;
    console.log(`${ok ? "PASS" : "FAIL"} ${ms} ms  "${sample.raw}"  top=${top ?? "none"} expected=${sample.expectedTop}`);
  }
  console.log(`${passed}/${sampleAsks.length} sample asks found their expected person first`);
  return passed === sampleAsks.length;
}

async function main() {
  console.log(`search: ${config.fakeSearch ? "in-memory" : "Elasticsearch"}`);
  if (process.argv.includes("--samples")) {
    if (!(await samples())) process.exitCode = 1;
    return;
  }
  const query = process.argv.slice(2).join(" ") || "scheduler preemption";
  const { results, ms } = await timed(query);
  console.log(`${results.length} people for "${query}" in ${ms} ms`);
  for (const r of results) {
    console.log(`- ${r.person.name} (${r.score.toFixed(2)}) ${r.highlights.join(" | ")}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

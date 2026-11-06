/**
 * Ask the search service a question from the command line and time it (B1).
 *   npm run try-search -- "scheduler preemption"
 *   npm run try-search -- --samples         checks each fixture sample ask finds its expected person first
 *   npm run try-search -- --ai "question"   refines with OpenAI first, then explains each result;
 *                                           run it twice and the repeat comes from ai_cache
 *   npm run try-search -- --ai --samples    the sample asks, refined first
 * Uses Elasticsearch unless FAKES includes "search", and OpenAI unless FAKES includes "ai".
 */
import { DEMO_USER_A, people, sampleAsks } from "@/contracts/fixtures";
import type { RefinedAsk } from "@/contracts/types";
import { cannedAi } from "@/server/ai/canned";
import { openAi } from "@/server/ai/openai";
import { config } from "@/server/config";
import { elasticSearch } from "@/server/search/elastic";
import { memorySearch } from "@/server/search/memory";

const search = config.fakeSearch ? memorySearch : elasticSearch;
const ai = config.fakeAi ? cannedAi : openAi;
const useAi = process.argv.includes("--ai");
const requester = people.find((p) => p.id === DEMO_USER_A) ?? people[0];

async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const started = performance.now();
  const value = await fn();
  return [value, Math.round(performance.now() - started)];
}

/** Search for a question as the demo user would: refined first when --ai is on. */
async function match(raw: string) {
  let refined: RefinedAsk | undefined;
  if (useAi) {
    const [value, ms] = await timed(() => ai.refineAsk(raw, requester));
    refined = value;
    console.log(`refined in ${ms} ms (${value.type}, ${value.minutes} min): "${value.text}"`);
  }
  const [results, ms] = await timed(() => search.searchCandidates(refined?.text ?? raw, { excludeIds: [requester.id] }));
  return { results, ms, refined };
}

async function samples(): Promise<boolean> {
  let passed = 0;
  for (const sample of sampleAsks) {
    const { results, ms } = await match(sample.raw); // sequential, so each timing stands alone
    const top = results[0]?.person.id;
    const ok = top === sample.expectedTop;
    if (ok) passed += 1;
    console.log(`${ok ? "PASS" : "FAIL"} ${ms} ms  "${sample.raw}"  top=${top ?? "none"} expected=${sample.expectedTop}`);
  }
  console.log(`${passed}/${sampleAsks.length} sample asks found their expected person first`);
  return passed === sampleAsks.length;
}

async function main() {
  const aiLabel = useAi ? `, AI: ${config.fakeAi ? "canned" : "OpenAI"}` : "";
  console.log(`search: ${config.fakeSearch ? "in-memory" : "Elasticsearch"}${aiLabel}`);
  if (process.argv.includes("--samples")) {
    if (!(await samples())) process.exitCode = 1;
    return;
  }
  const raw = process.argv.slice(2).filter((arg) => !arg.startsWith("--")).join(" ") || "scheduler preemption";
  const { results, ms, refined } = await match(raw);
  console.log(`${results.length} people for "${refined?.text ?? raw}" in ${ms} ms`);
  let lines: string[] = [];
  if (refined) {
    const [value, explainMs] = await timed(() => ai.explain(refined, results));
    lines = value;
    console.log(`explained in ${explainMs} ms`);
  }
  for (const [i, r] of results.entries()) {
    console.log(`- ${r.person.name} (${r.score.toFixed(2)}) ${r.highlights.join(" | ")}`);
    if (lines[i]) console.log(`    why: ${lines[i]}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * Ask the search service a question from the command line and time it (B1).
 *   npm run try-search -- "scheduler preemption"
 *   npm run try-search -- --samples         checks each fixture sample ask finds its expected person first
 *   npm run try-search -- --ai "question"   refines with OpenAI first, then explains each result;
 *                                           run it twice and the repeat comes from ai_cache
 *   npm run try-search -- --ai --samples    the sample asks, refined first
 *   FAKE_API=0 npm run try-search -- --audit
 *                                           match quality: varied asks through the whole match pipeline
 *                                           (refine, search, explain, fit); counts off-topic cards
 * Uses Elasticsearch unless FAKES includes "search" (then the in-memory search, loaded with the fixtures and
 * the synthetic attendees, as the seed loads Elasticsearch), and OpenAI unless FAKES includes "ai".
 */
import { readFileSync } from "node:fs";
import { DEMO_USER_A, evidence as fixtureEvidence, people, sampleAsks } from "@/contracts/fixtures";
import type { EvidenceDoc, MatchResult, Person, RefinedAsk } from "@/contracts/types";
import type { Explanation } from "@/server/ai";
import { cannedAi } from "@/server/ai/canned";
import { openAi } from "@/server/ai/openai";
import { config } from "@/server/config";
import { runMatch } from "@/server/pipeline";
import { elasticSearch } from "@/server/search/elastic";
import { memorySearch } from "@/server/search/memory";

const search = config.fakeSearch ? memorySearch : elasticSearch;
const ai = config.fakeAi ? cannedAi : openAi;
const useAi = process.argv.includes("--ai");
const requester = people.find((p) => p.id === DEMO_USER_A) ?? people[0];
const SYNTHETIC = "scripts/synthetic/people.json";

/** The in-memory search starts with only the fixtures: add the synthetic attendees, as the seed does for Elasticsearch. */
async function loadSynthetic(): Promise<void> {
  const file = JSON.parse(readFileSync(SYNTHETIC, "utf8")) as { people: Person[]; evidence: EvidenceDoc[] };
  for (const person of file.people) await memorySearch.ingestPerson(person, file.evidence.filter((e) => e.personId === person.id));
}

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

/**
 * Varied asks, each with the words that mark a card as on topic, and what the asker wants of the
 * hiring flag. Measured 2026-11-09 before the quality fixes: 9 of 15 answerable-looking asks showed
 * mostly off-topic cards, 5 asks nobody in the data can answer still showed 10 cards each.
 */
const AUDIT: { raw: string; topic: RegExp; hiring?: boolean }[] = [
  { raw: "How do I tune PostgreSQL autovacuum for a write-heavy table?", topic: /postgres|vacuum/i },
  { raw: "Who can explain Kubernetes scheduler preemption?", topic: /kubernetes|scheduler|k8s/i },
  { raw: "I want to learn how Rust async runtimes like Tokio work", topic: /rust|tokio|async/i },
  { raw: "How do you evaluate LLM outputs in production?", topic: /llm|eval|language model/i },
  { raw: "Best practices for accessibility in React apps", topic: /accessib|a11y|wcag/i },
  { raw: "How does Raft leader election work?", topic: /raft|consensus/i },
  { raw: "I want to meet a potential employer from healthcare. What kind of roles are you hiring for?", topic: /healthcare|medical|hospital|clinical|patient/i, hiring: true },
  { raw: "I want to work at Stripe", topic: /stripe/i, hiring: true },
  { raw: "I want a job in game development", topic: /\bgames?\b|game dev/i, hiring: true },
  { raw: "How do I move from frontend work into machine learning engineering?", topic: /machine learning|\bml\b|model training/i },
  { raw: "We're hiring Rust engineers for a database team", topic: /rust/i, hiring: false },
  { raw: "Looking for a product designer who knows design systems", topic: /design system|figma|product design/i, hiring: false },
  { raw: "I need a data engineer with Spark experience", topic: /spark|data engineer/i, hiring: false },
  { raw: "I want to build an open-source observability tool with OpenTelemetry together", topic: /opentelemetry|observability|tracing/i },
  { raw: "Looking for a co-author for climate modelling research", topic: /climate/i },
  { raw: "How do I map EHR data to the OMOP common data model?", topic: /omop|\behr\b|electronic health record/i },
  { raw: "Who can explain FHIR subscriptions for hospital integrations?", topic: /fhir|hl7/i },
  { raw: "I need help segmenting tumours in CT scans with nnU-Net", topic: /segment|nnu-net|monai/i },
  { raw: "Looking for a collaborator on single-cell RNA-seq cell type annotation", topic: /single-cell|scrna|scanpy|seurat/i },
  { raw: "How do you validate a sepsis prediction model before deployment?", topic: /sepsis|early warning|deterioration/i },
  { raw: "How do I estimate the reproduction number during an outbreak?", topic: /outbreak|transmission|reproduction number/i },
  { raw: "best sourdough bread recipe", topic: /bread|sourdough|baking/i },
];

/** Everyone the audit could find, with their evidence text, to count who could answer each ask. */
function auditPeople(): { person: Person; text: string }[] {
  const synthetic = JSON.parse(readFileSync(SYNTHETIC, "utf8")) as { people: Person[]; evidence: { personId: string }[] };
  const evidenceText = new Map<string, string>();
  for (const e of [...synthetic.evidence, ...fixtureEvidence]) evidenceText.set(e.personId, `${evidenceText.get(e.personId) ?? ""} ${JSON.stringify(e)}`);
  return [...synthetic.people, ...people].filter((p) => p.id !== requester.id)
    .map((person) => ({ person, text: `${JSON.stringify(person)} ${evidenceText.get(person.id) ?? ""}` }));
}

function hiringNote(q: (typeof AUDIT)[number], results: MatchResult[]): string {
  if (q.hiring === undefined) return "";
  const want = q.hiring ? "hiring" : "not hiring";
  return `, hiring ${results.filter((r) => r.person.filters.hiring).length} (want ${want})`;
}

async function audit(): Promise<void> {
  const everyone = auditPeople();
  let offTopic = 0;
  let padded = 0;
  for (const [i, q] of AUDIT.entries()) {
    const exist = everyone.filter((p) => q.topic.test(p.text)).length;
    const ask = { id: `audit-${i}`, userId: requester.id, rawText: q.raw, refined: null, status: "open" as const, softBlocker: false, createdAt: new Date().toISOString() };
    const results = await runMatch({ ask, requester, excludeIds: [], hiddenBelowRank: null }); // sequential: one ask at a time
    const on = (r: MatchResult) => q.topic.test(`${JSON.stringify(r.person)} ${r.highlights.join(" ")}`);
    const off = results.filter((r) => !on(r)).length;
    offTopic += off;
    if (!exist && results.length) padded += 1;
    const nearest = results.length > 0 && !results.some((r) => r.fit === "strong") ? " | shown as 'nearest'" : "";
    console.log(`
"${q.raw}"
  exist ${exist} | shown ${results.length}, off topic ${off}${hiringNote(q, results)}${nearest}`);
    for (const r of results) console.log(`  ${on(r) ? "✓" : "✗"} ${r.fit ?? "-"} ${r.person.filters.hiring ? "H" : "-"} ${r.person.name}: ${r.explanation}`.slice(0, 170));
  }
  console.log(`
Total off-topic cards: ${offTopic}. Asks nobody can answer that still showed cards: ${padded}.`);
}

async function main() {
  const aiLabel = useAi ? `, AI: ${config.fakeAi ? "canned" : "OpenAI"}` : "";
  console.log(`search: ${config.fakeSearch ? "in-memory" : "Elasticsearch"}${aiLabel}`);
  if (config.fakeSearch) await loadSynthetic();
  if (process.argv.includes("--audit")) return audit();
  if (process.argv.includes("--samples")) {
    if (!(await samples())) process.exitCode = 1;
    return;
  }
  const raw = process.argv.slice(2).filter((arg) => !arg.startsWith("--")).join(" ") || "scheduler preemption";
  const { results, ms, refined } = await match(raw);
  console.log(`${results.length} people for "${refined?.text ?? raw}" in ${ms} ms`);
  let lines: Explanation[] = [];
  if (refined) {
    const [value, explainMs] = await timed(() => ai.explain(refined, results));
    lines = value;
    console.log(`explained in ${explainMs} ms`);
  }
  for (const [i, r] of results.entries()) {
    console.log(`- ${r.person.name} (${r.score.toFixed(2)}) ${r.highlights.join(" | ")}`);
    if (lines[i]) console.log(`    why (${lines[i].fit ?? "not judged"}): ${lines[i].why}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

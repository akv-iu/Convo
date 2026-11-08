/**
 * The four-step match pipeline (B1). Each step is its own span so Dash0
 * shows the slowest one at a glance.
 */
import { trace } from "@opentelemetry/api";
import type { Ask, MatchResult, Person } from "@/contracts/types";
import { ai } from "@/server/ai";
import { search } from "@/server/search";

const tracer = trace.getTracer("convo");

function step<T>(name: string, fn: () => Promise<T>): Promise<T> {
  return tracer.startActiveSpan(`match.${name}`, async (span) => {
    try {
      return await fn();
    } finally {
      span.end();
    }
  });
}

export function badgesFor(person: Person): string[] {
  const badges = [person.filters.hiring ? "hiring" : "not hiring", person.filters.country];
  if (person.synthetic) badges.push("synthetic");
  return badges;
}

/** How many people one match shows. */
const SHOWN = 10;
/**
 * How many people are ranked every time, however many are hidden: Elasticsearch's whole window.
 * Growing the pool per hidden person let a mutual match from further down jump above people
 * already ranked, moving them. ponytail: after 40 hidden people fewer than ten show; widen it then.
 */
const POOL = 50;

export interface MatchInput {
  ask: Ask;
  requester: Person;
  /** Never searched (the requester is always added). */
  excludeIds: string[];
  /**
   * Ranked, then left out: people this ask already passed on or sent a request to. Ranking them
   * keeps everyone else's rank the same across refreshes, so a rank sent with a rejection keeps
   * meaning the same place in the list.
   */
  hideIds?: string[];
  /** Search box on the results screen. */
  query?: string;
  /** From the batch-reject rule: only results ranked above this are shown. */
  hiddenBelowRank: number | null;
}

/** Evidence without Elasticsearch's <em> marks, for the model (and its cache keys). */
const plain = (highlight: string) => highlight.replace(/<\/?em>/g, "");

export async function runMatch(input: MatchInput): Promise<MatchResult[]> {
  const refined = await step("understand", async () => input.ask.refined ?? ai.refineAsk(input.ask.rawText, input.requester));

  const hide = new Set(input.hideIds);
  const candidates = await step("search", () =>
    search.searchCandidates(input.query ? `${refined.text} ${input.query}` : refined.text, {
      excludeIds: [input.requester.id, ...input.excludeIds],
      freeTimes: input.requester.freeTimes,
    }, POOL),
  );

  // Mutual: the candidate's own asks match the requester. One reverse search covers every candidate.
  const mutual = await step("mutual", async () => new Set(await search.whoIsLookingFor(input.requester)));

  const ranked = candidates
    .map((c) => ({ ...c, score: c.score + (mutual.has(c.person.id) ? 1 : 0) }))
    .sort((a, b) => b.score - a.score);
  // Rank first, then hide, so ranks don't shift as people are passed on or sent a request.
  // Hidden results are never shown, so they are never explained (or paid for).
  const shown = ranked
    .map((c, rank) => ({ ...c, rank }))
    .filter((c) => !hide.has(c.person.id) && (input.hiddenBelowRank === null || c.rank < input.hiddenBelowRank))
    .slice(0, SHOWN);

  // The model reads plain evidence lines only (not the evidence links), so its cache keys don't
  // change; the card keeps the <em> marks on matched words.
  const explanations = await step("explain", () =>
    ai.explain(refined, shown.map((c) => ({ person: c.person, highlights: c.highlights.map(plain), evidence: [], score: c.score }))));

  return shown.map((c, i) => ({
    person: c.person,
    highlights: c.highlights,
    evidence: c.evidence,
    badges: badgesFor(c.person),
    mutual: mutual.has(c.person.id),
    explanation: explanations[i] ?? "",
    score: c.score,
    rank: c.rank,
  }));
}

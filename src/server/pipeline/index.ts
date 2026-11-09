/**
 * The four-step match pipeline (B1). Each step is its own span so Dash0
 * shows the slowest one at a glance.
 */
import { trace } from "@opentelemetry/api";
import type { Ask, MatchResult, Person } from "@/contracts/types";
import { ai } from "@/server/ai";
import { search } from "@/server/search";
import { narrowTo, readNarrowing } from "./narrow";

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
 * The request matcher keeps only people within reach of the best match: a candidate scoring under
 * this share of the top score shares little of the question (a word or two of a long ask).
 */
const RELEVANCE = 0.3;
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
  // The person finder (see ./narrow) filters the request matcher's list; it is not part of the search.
  const narrowing = readNarrowing(input.query ?? "");
  const found = await step("search", () =>
    search.searchCandidates(refined.text, {
      excludeIds: [input.requester.id, ...input.excludeIds],
      freeTimes: input.requester.freeTimes,
    }, POOL),
  );
  const best = Math.max(0, ...found.map((c) => c.score));
  const candidates = found.filter((c) => c.score >= RELEVANCE * best);

  // Mutual: the candidate's own asks match the requester. One reverse search covers every candidate.
  const mutual = await step("mutual", async () => new Set(await search.whoIsLookingFor(input.requester)));

  const ranked = candidates
    .map((c) => ({ ...c, score: c.score + (mutual.has(c.person.id) ? 1 : 0) }))
    .sort((a, b) => b.score - a.score);
  // Rank first, then hide, so ranks don't shift as people are passed on or sent a request.
  // Hidden results are never shown, so they are never explained (or paid for).
  // A country or place in the search box narrows who's shown, after ranking, so ranks stay the same.
  const fits = narrowTo(narrowing);
  const shown = ranked
    .map((c, rank) => ({ ...c, rank }))
    .filter((c) => !hide.has(c.person.id) && (input.hiddenBelowRank === null || c.rank < input.hiddenBelowRank) && fits(c.person))
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

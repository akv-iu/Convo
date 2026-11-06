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

export interface MatchInput {
  ask: Ask;
  requester: Person;
  /** The requester, rejected people, and anyone else to leave out. */
  excludeIds: string[];
  /** Search box on the results screen. */
  query?: string;
  /** From the batch-reject rule: hide results ranked below this. */
  hiddenBelowRank: number | null;
}

export async function runMatch(input: MatchInput): Promise<MatchResult[]> {
  const refined = await step("understand", async () => input.ask.refined ?? ai.refineAsk(input.ask.rawText, input.requester));

  const candidates = await step("search", () =>
    search.searchCandidates(input.query ? `${refined.text} ${input.query}` : refined.text, {
      excludeIds: [input.requester.id, ...input.excludeIds],
      freeTimes: input.requester.freeTimes,
    }),
  );

  // Mutual: the candidate's own asks match the requester. One reverse search covers every candidate.
  const mutual = await step("mutual", async () => new Set(await search.whoIsLookingFor(input.requester)));

  const ranked = candidates
    .map((c) => ({ ...c, score: c.score + (mutual.has(c.person.id) ? 1 : 0) }))
    .sort((a, b) => b.score - a.score);

  const explanations = await step("explain", () => ai.explain(refined, ranked));

  return ranked
    .map((c, rank) => ({
      person: c.person,
      highlights: c.highlights,
      badges: badgesFor(c.person),
      mutual: mutual.has(c.person.id),
      explanation: explanations[rank] ?? "",
      score: c.score,
      rank,
    }))
    .filter((r) => input.hiddenBelowRank === null || r.rank < input.hiddenBelowRank);
}

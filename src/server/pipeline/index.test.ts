import { describe, expect, it, vi } from "vitest";
import { people } from "@/contracts/fixtures";
import type { Ask } from "@/contracts/types";

const search = vi.hoisted(() => ({ searchCandidates: vi.fn(), whoIsLookingFor: vi.fn() }));
const ai = vi.hoisted(() => ({ refineAsk: vi.fn(), explain: vi.fn(async (_ask: unknown, list: unknown[]) => list.map(() => "Why")) }));
vi.mock("@/server/search", () => ({ search }));
vi.mock("@/server/ai", () => ({ ai }));

import { runMatch } from "./index";

const [requester, alsoLooking, onlyWanted] = people.map((p) => structuredClone(p));
const ask: Ask = {
  id: "ask-1", userId: requester.id, rawText: "scheduler preemption", status: "open", softBlocker: true,
  refined: { text: "scheduler preemption", type: "knowledge", minutes: 10 }, createdAt: "2026-11-06T10:00:00Z",
};

describe("mutual interest", () => {
  it("marks candidates whose own asks match the requester, with one reverse search", async () => {
    search.searchCandidates.mockResolvedValueOnce([
      { person: onlyWanted, highlights: ["a"], score: 2.5 },
      { person: alsoLooking, highlights: ["b"], score: 2 },
    ]);
    search.whoIsLookingFor.mockResolvedValueOnce([alsoLooking.id, "someone-else"]);

    const results = await runMatch({ ask, requester, excludeIds: [], hiddenBelowRank: null });

    expect(search.whoIsLookingFor).toHaveBeenCalledTimes(1);
    expect(search.whoIsLookingFor).toHaveBeenCalledWith(requester);
    expect(results.map((r) => [r.person.id, r.mutual, r.score])).toEqual([
      [alsoLooking.id, true, 3],
      [onlyWanted.id, false, 2.5],
    ]);
  });
});

describe("batch reject", () => {
  it("hides results below the cut-off and never explains them", async () => {
    search.searchCandidates.mockResolvedValueOnce([
      { person: onlyWanted, highlights: ["a"], score: 2.5 },
      { person: alsoLooking, highlights: ["b"], score: 2 },
    ]);
    search.whoIsLookingFor.mockResolvedValueOnce([]);

    const results = await runMatch({ ask, requester, excludeIds: [], hiddenBelowRank: 1 });

    expect(results.map((r) => [r.person.id, r.rank, r.explanation])).toEqual([[onlyWanted.id, 0, "Why"]]);
    expect(ai.explain).toHaveBeenLastCalledWith(ask.refined, [expect.objectContaining({ person: onlyWanted })]);
  });
});

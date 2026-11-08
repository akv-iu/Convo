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

describe("people already passed on or sent a request", () => {
  const third = structuredClone(people[3]);
  const ranked = () => [
    { person: onlyWanted, highlights: ["a"], score: 3 },
    { person: alsoLooking, highlights: ["b"], score: 2 },
    { person: third, highlights: ["c"], score: 1 },
  ];

  it("are ranked but not shown, so everyone else keeps their rank", async () => {
    search.searchCandidates.mockResolvedValueOnce(ranked());
    search.whoIsLookingFor.mockResolvedValueOnce([]);

    const results = await runMatch({ ask, requester, excludeIds: [], hideIds: [onlyWanted.id], hiddenBelowRank: null });

    expect(results.map((r) => [r.person.id, r.rank])).toEqual([[alsoLooking.id, 1], [third.id, 2]]);
    expect(ai.explain).toHaveBeenLastCalledWith(ask.refined, [
      expect.objectContaining({ person: alsoLooking }), expect.objectContaining({ person: third }),
    ]);
  });

  it("move nobody when a mutual match from further down outranks the people shown", async () => {
    // Eleven people by search score; the eleventh also wants to meet the requester, and +1 lifts it to second.
    const pool = Array.from({ length: 11 }, (_, i) => ({
      person: { ...structuredClone(onlyWanted), id: `p${i}` }, highlights: [], score: i ? 4.5 - i / 10 : 5,
    }));
    const ranks = async (hideIds: string[]) => {
      search.searchCandidates.mockImplementationOnce(async (_q: string, _f: unknown, limit = 10) => pool.slice(0, limit));
      search.whoIsLookingFor.mockResolvedValueOnce(["p10"]);
      const results = await runMatch({ ask, requester, excludeIds: [], hideIds, hiddenBelowRank: null });
      return new Map(results.map((r) => [r.person.id, r.rank]));
    };

    const before = await ranks([]);
    const after = await ranks(["p0"]); // passed on the first card

    const both = [...after].filter(([id]) => before.has(id));
    expect(both).toEqual(both.map(([id]) => [id, before.get(id)]));
    expect(after.size).toBe(10); // the next person fills the hidden place
  });

  it("leave nobody below the cutoff: only ranks above it can show", async () => {
    search.searchCandidates.mockResolvedValueOnce(ranked());
    search.whoIsLookingFor.mockResolvedValueOnce([]);

    // Ranks 0 and 1 passed on (cutoff 1): rank 2 is below the last rejection, so nothing shows.
    const results = await runMatch({ ask, requester, excludeIds: [], hideIds: [onlyWanted.id, alsoLooking.id], hiddenBelowRank: 1 });

    expect(results).toEqual([]);
  });
});

describe("evidence highlights", () => {
  it("keeps <em> marks on the card but gives the model plain text", async () => {
    search.searchCandidates.mockResolvedValueOnce([{ person: onlyWanted, highlights: ["Maintains <em>preemption</em> code"], evidence: [], score: 1 }]);
    search.whoIsLookingFor.mockResolvedValueOnce([]);

    const [result] = await runMatch({ ask, requester, excludeIds: [], hiddenBelowRank: null });

    expect(result.highlights).toEqual(["Maintains <em>preemption</em> code"]);
    expect(ai.explain).toHaveBeenLastCalledWith(ask.refined, [expect.objectContaining({ highlights: ["Maintains preemption code"] })]);
  });

  it("passes each candidate's evidence links to the card, but not to the model", async () => {
    const evidence = [{ kind: "repo" as const, title: "etcd-io/raft", url: "https://github.com/etcd-io/raft" }];
    search.searchCandidates.mockResolvedValueOnce([{ person: onlyWanted, highlights: ["etcd-io/raft"], evidence, score: 1 }]);
    search.whoIsLookingFor.mockResolvedValueOnce([]);

    const [result] = await runMatch({ ask, requester, excludeIds: [], hiddenBelowRank: null });

    expect(result.evidence).toEqual(evidence);
    // The explain step sees no links, so its cache keys (built from highlights) are unchanged.
    const sent = ai.explain.mock.calls.at(-1)![1] as { evidence: unknown[] }[];
    expect(sent[0].evidence).toEqual([]);
  });
});

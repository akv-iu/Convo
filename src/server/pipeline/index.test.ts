import { describe, expect, it, vi } from "vitest";
import { people } from "@/contracts/fixtures";
import type { Ask } from "@/contracts/types";
import type { Explanation } from "@/server/ai";

const search = vi.hoisted(() => ({ searchCandidates: vi.fn(), whoIsLookingFor: vi.fn() }));
const ai = vi.hoisted(() => ({ refineAsk: vi.fn(), explain: vi.fn(async (_ask: unknown, list: unknown[]): Promise<Explanation[]> => list.map(() => ({ why: "Why" }))) }));
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

describe("fit", () => {
  it("leaves out people the model judged unrelated, keeping everyone's rank, and passes the fit on", async () => {
    const third = structuredClone(people[3]);
    search.searchCandidates.mockResolvedValueOnce([
      { person: onlyWanted, highlights: ["a"], score: 3 },
      { person: alsoLooking, highlights: ["b"], score: 2 },
      { person: third, highlights: ["c"], score: 1 },
    ]);
    search.whoIsLookingFor.mockResolvedValueOnce([]);
    ai.explain.mockResolvedValueOnce([{ why: "Strong.", fit: "strong" }, { why: "Unrelated.", fit: "none" }, { why: "Not judged." }]);

    const results = await runMatch({ ask, requester, excludeIds: [], hiddenBelowRank: null });

    expect(results.map((r) => [r.person.id, r.rank, r.explanation, r.fit])).toEqual([
      [onlyWanted.id, 0, "Strong.", "strong"],
      [third.id, 2, "Not judged.", undefined],
    ]);
    expect(results[1]).not.toHaveProperty("fit");
  });
});

describe("no strong fit", () => {
  it("shows only the three nearest when the model found no strong fit", async () => {
    const five = people.slice(0, 5).map((p, i) => ({ person: structuredClone(p), highlights: [`e${i}`], score: 5 - i }));
    search.searchCandidates.mockResolvedValueOnce(five.slice(1)); // the requester is never a candidate
    search.whoIsLookingFor.mockResolvedValueOnce([]);
    ai.explain.mockResolvedValueOnce([{ why: "a", fit: "partial" }, { why: "b", fit: "none" }, { why: "c", fit: "partial" }, { why: "d", fit: "partial" }]);
    const results = await runMatch({ ask, requester, excludeIds: [], hiddenBelowRank: null });
    expect(results.map((r) => r.explanation)).toEqual(["a", "c", "d"]);

    search.searchCandidates.mockResolvedValueOnce(five.slice(1));
    search.whoIsLookingFor.mockResolvedValueOnce([]);
    ai.explain.mockResolvedValueOnce([{ why: "a", fit: "partial" }, { why: "b", fit: "partial" }, { why: "c", fit: "partial" }, { why: "d", fit: "strong" }]);
    expect((await runMatch({ ask, requester, excludeIds: [], hiddenBelowRank: null })).map((r) => r.explanation)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("hiring preference", () => {
  const ranked = () => [
    { person: { ...structuredClone(onlyWanted), filters: { ...onlyWanted.filters, hiring: false } }, highlights: ["a"], score: 3 },
    { person: { ...structuredClone(alsoLooking), filters: { ...alsoLooking.filters, hiring: true } }, highlights: ["b"], score: 2.5 },
  ];
  const match = async (type: "career" | "hiring" | "knowledge", list = ranked()) => {
    search.searchCandidates.mockResolvedValueOnce(list);
    search.whoIsLookingFor.mockResolvedValueOnce([]);
    const results = await runMatch({ ask: { ...ask, refined: { ...ask.refined!, type } }, requester, excludeIds: [], hiddenBelowRank: null });
    return results.map((r) => r.person.id);
  };

  it("puts people who are hiring first for a career ask, and people who aren't for a hiring ask", async () => {
    expect(await match("career")).toEqual([alsoLooking.id, onlyWanted.id]);
    expect(await match("hiring")).toEqual([onlyWanted.id, alsoLooking.id]);
    expect(await match("knowledge")).toEqual([onlyWanted.id, alsoLooking.id]);
  });

  it("never lets a hidden hiring flag change the order, for a career or a hiring ask", async () => {
    const hiddenHiring = ranked();
    hiddenHiring[1].person.visibility = { country: true, workplace: true, hiring: false };
    expect(await match("career", hiddenHiring)).toEqual([onlyWanted.id, alsoLooking.id]);

    // A hidden "not hiring" must not read as "not hiring" either: no boost for a hiring ask.
    const hiddenNotHiring = ranked().reverse().map((c, i) => ({ ...c, score: 3 - i * 0.5 }));
    hiddenNotHiring[1].person.visibility = { country: true, workplace: true, hiring: false };
    expect(await match("hiring", hiddenNotHiring)).toEqual([alsoLooking.id, onlyWanted.id]);
  });
});

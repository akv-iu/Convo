import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_USER_B, people } from "@/contracts/fixtures";
import type { EvidenceDoc, Person } from "@/contracts/types";

const es = vi.hoisted(() => ({
  index: vi.fn(), bulk: vi.fn(), deleteByQuery: vi.fn(), search: vi.fn(), get: vi.fn(), mget: vi.fn(),
}));
vi.mock("@elastic/elasticsearch", () => {
  class ResponseError extends Error {
    constructor(readonly statusCode: number) { super(`HTTP ${statusCode}`); }
  }
  return { Client: class { constructor() { return es; } }, errors: { ResponseError } };
});

import { errors } from "@elastic/elasticsearch";
import { elasticSearch } from "./elastic";

const httpError = (status: number) => new (errors.ResponseError as unknown as new (status: number) => Error)(status);
const slot = { start: "2026-11-09T18:00:00Z", end: "2026-11-09T18:30:00Z" };
const person: Person = { ...structuredClone(people[0]), id: "p_test", freeTimes: [slot] };
const repo: EvidenceDoc = { id: "p_test:repo:sched", personId: "p_test", kind: "repo", title: "sched", text: "Scheduler preemption.", url: "https://github.com/x/sched" };
const call = (fn: ReturnType<typeof vi.fn>, n = 0) => fn.mock.calls[n][0];

beforeAll(() => {
  vi.stubEnv("ELASTICSEARCH_URL", "https://es.example.invalid");
  vi.stubEnv("ELASTICSEARCH_API_KEY", "test-key");
});

beforeEach(() => {
  for (const fn of Object.values(es)) fn.mockReset();
  es.index.mockResolvedValue({});
  es.bulk.mockResolvedValue({ errors: false, items: [] });
  es.deleteByQuery.mockResolvedValue({});
  es.search.mockResolvedValue({ hits: { hits: [] } });
  es.mget.mockResolvedValue({ docs: [] });
});

describe("ingestPerson", () => {
  it("writes the person and replaces their evidence at the save's revision", async () => {
    await elasticSearch.ingestPerson(person, [repo], 7);
    expect(call(es.index)).toMatchObject({ index: "people", id: "p_test", version: 7, version_type: "external_gte" });
    expect(call(es.index).document.profile).toContain("sched. Scheduler preemption.");
    const ops = call(es.bulk).operations;
    expect(ops[0]).toEqual({ index: { _index: "evidence", _id: "p_test:repo:sched", version: 7, version_type: "external_gte" } });
    expect(ops[1]).toMatchObject({
      person_id: "p_test", kind: "repo", content: "sched. Scheduler preemption.", revision: 7,
      country: person.filters.country, hiring: person.filters.hiring, free_times: [{ gte: slot.start, lt: slot.end }],
    });
    expect(ops[2]).toMatchObject({ index: { _id: "p_test:profile" } });
    expect(ops[3]).toMatchObject({ kind: "profile", title: person.name });
    expect(call(es.deleteByQuery).query.bool).toEqual({
      filter: [{ term: { person_id: "p_test" } }, { range: { revision: { lte: 7 } } }],
      must_not: [{ ids: { values: ["p_test:repo:sched", "p_test:profile"] } }],
    });
  });

  it("gives a name-only profile no document, and removes one indexed before", async () => {
    const nameOnly = { ...person, bio: " ", organisations: [], languages: [] };
    es.bulk.mockResolvedValueOnce({ errors: true, items: [{ index: { status: 201 } }, { delete: { status: 404 } }] });
    await elasticSearch.ingestPerson(nameOnly, [repo], 9);
    const ops = call(es.bulk).operations;
    expect(ops).toHaveLength(3);
    expect(ops[2]).toEqual({ delete: { _index: "evidence", _id: "p_test:profile", version: 9, version_type: "external_gte" } });
    expect(call(es.deleteByQuery).query.bool.must_not).toEqual([{ ids: { values: ["p_test:repo:sched"] } }]);
  });

  it("ignores a save older than the one already indexed", async () => {
    es.index.mockRejectedValueOnce(httpError(409));
    await expect(elasticSearch.ingestPerson(person, [repo], 3)).resolves.toBeUndefined();
    expect(es.bulk).not.toHaveBeenCalled();
    expect(es.deleteByQuery).not.toHaveBeenCalled();
  });

  it("keeps stored evidence when a profile save carries none", async () => {
    es.search.mockResolvedValueOnce({ hits: { hits: [{ _id: repo.id, _source: { kind: "repo", title: "sched", text: "Scheduler preemption." } }] } });
    await elasticSearch.ingestPerson(person, undefined, 8);
    expect(call(es.index).document.profile).toContain("Scheduler preemption.");
    expect(call(es.bulk).operations[0]).toMatchObject({ index: { _id: repo.id, version: 8 } });
    expect(es.deleteByQuery).not.toHaveBeenCalled();
  });

  it("fails when evidence indexing fails, but tolerates documents a newer save already wrote", async () => {
    es.bulk.mockResolvedValueOnce({ errors: true, items: [{ index: { status: 409 } }, { index: { status: 201 } }] });
    await expect(elasticSearch.ingestPerson(person, [repo], 5)).resolves.toBeUndefined();
    es.bulk.mockResolvedValueOnce({ errors: true, items: [{ index: { status: 500, error: { reason: "inference failed" } } }] });
    await expect(elasticSearch.ingestPerson(person, [repo], 5)).rejects.toThrow("inference failed");
  });
});

describe("searchCandidates", () => {
  const hits = [
    { _score: 2, _source: { person_id: DEMO_USER_B, kind: "repo", title: "Maintains pkg/scheduler", text: "..." }, highlight: { text: ["Preemption picks <em>victims</em>"] } },
    { _score: 1.5, _source: { person_id: DEMO_USER_B, kind: "talk", title: "KubeCon talk", text: "..." } },
    { _score: 1, _source: { person_id: "p_002", kind: "profile", title: "Name", text: "Bio text" } },
    { _score: 0.5, _source: { person_id: "gone", kind: "repo", title: "t", text: "x" } },
  ];
  const lookup = (id: string) => ({ ...structuredClone(people[0]), id });

  it("fuses keyword and semantic search per person, filtered, boosted and reranked", async () => {
    es.search.mockResolvedValueOnce({ hits: { hits } });
    es.mget.mockResolvedValueOnce({ docs: [
      { _id: DEMO_USER_B, found: true, _source: { person: lookup(DEMO_USER_B) } },
      { _id: "p_002", found: true, _source: { person: lookup("p_002") } },
      { _id: "gone", found: false },
    ] });
    const results = await elasticSearch.searchCandidates("scheduler preemption", { excludeIds: ["u_demo_a"], freeTimes: [slot], hard: { hiring: true } });

    const reranker = call(es.search).retriever.text_similarity_reranker;
    expect(reranker).toMatchObject({ inference_id: ".jina-reranker-v3.5", field: "content", inference_text: "scheduler preemption" });
    const rrf = reranker.retriever.rrf;
    expect(rrf.filter).toEqual([{ bool: { must_not: [{ terms: { person_id: ["u_demo_a"] } }] } }, { term: { hiring: true } }]);
    expect(rrf.retrievers[1].standard.min_score).toBe(4);
    for (const child of rrf.retrievers) {
      expect(child.standard.collapse).toEqual({ field: "person_id" });
      expect(child.standard.query.bool.should).toEqual([{ range: { free_times: { gte: slot.start, lt: slot.end, relation: "intersects", boost: 0.5 } } }]);
    }
    expect(results.map((r) => [r.person.id, r.score, r.highlights])).toEqual([
      [DEMO_USER_B, 5, ["Maintains pkg/scheduler: Preemption picks victims", "KubeCon talk"]],
      ["p_002", 2.5, ["Bio text"]],
    ]);
  });

  it("serves the hybrid ranking when the hosted reranker fails", async () => {
    es.search.mockRejectedValueOnce(new Error("inference endpoint unavailable")).mockResolvedValueOnce({ hits: { hits: [] } });
    await expect(elasticSearch.searchCandidates("etcd", { excludeIds: [] })).resolves.toEqual([]);
    expect(call(es.search, 1).retriever).toHaveProperty("rrf");
    expect(es.mget).not.toHaveBeenCalled();
  });

  it("returns at most the requested number of people", async () => {
    es.search.mockResolvedValueOnce({ hits: { hits } });
    es.mget.mockResolvedValueOnce({ docs: [{ _id: DEMO_USER_B, found: true, _source: { person: lookup(DEMO_USER_B) } }] });
    const results = await elasticSearch.searchCandidates("scheduler", { excludeIds: [] }, 1);
    expect(results.map((r) => r.person.id)).toEqual([DEMO_USER_B]);
    expect(call(es.mget).ids).toEqual([DEMO_USER_B]);
  });
});

describe("asks and reverse search", () => {
  it("registers an ask once and never revives a resolved one", async () => {
    await elasticSearch.registerAsk("ask-1", "u1", "kubernetes scheduler preemption");
    expect(call(es.index)).toMatchObject({
      index: "asks", id: "ask-1", op_type: "create",
      document: { user_id: "u1", active: true, query: { match: { profile: { query: "kubernetes scheduler preemption" } } } },
    });
    es.index.mockRejectedValueOnce(httpError(409));
    await expect(elasticSearch.registerAsk("ask-1", "u1", "again")).resolves.toBeUndefined();
    es.index.mockRejectedValueOnce(httpError(503));
    await expect(elasticSearch.registerAsk("ask-2", "u1", "x")).rejects.toThrow("HTTP 503");
  });

  it("resolves an ask by leaving a tombstone that can never match", async () => {
    await elasticSearch.removeAsk("ask-1");
    expect(call(es.index)).toEqual({ index: "asks", id: "ask-1", document: { ask_id: "ask-1", active: false, query: { match_none: {} } } });
  });

  it("finds distinct askers by percolating the person's indexed profile", async () => {
    es.get.mockResolvedValueOnce({ _source: { profile: "indexed profile text" } });
    es.search.mockResolvedValueOnce({ hits: { hits: [] }, aggregations: { askers: { buckets: [{ key: "u1", doc_count: 2 }, { key: "u2", doc_count: 1 }] } } });
    expect(await elasticSearch.whoIsLookingFor(person)).toEqual(["u1", "u2"]);
    expect(call(es.search).query.bool).toEqual({
      filter: [{ percolate: { field: "query", document: { profile: "indexed profile text" } } }, { term: { active: true } }],
      must_not: [{ term: { user_id: "p_test" } }],
    });
  });

  it("uses the person's own fields when they are not indexed yet", async () => {
    es.get.mockRejectedValueOnce(httpError(404));
    es.search.mockResolvedValueOnce({ hits: { hits: [] }, aggregations: { askers: { buckets: [] } } });
    expect(await elasticSearch.whoIsLookingFor(person)).toEqual([]);
    expect(call(es.search).query.bool.filter[0].percolate.document.profile).toContain(person.bio);
  });
});

describe("lookups", () => {
  it("returns a stored person, and undefined when missing or malformed", async () => {
    es.get.mockResolvedValueOnce({ _source: { person } });
    expect(await elasticSearch.getPerson("p_test")).toEqual(person);
    es.get.mockRejectedValueOnce(httpError(404));
    expect(await elasticSearch.getPerson("nobody")).toBeUndefined();
    es.get.mockResolvedValueOnce({ _source: { person: { id: "broken" } } });
    expect(await elasticSearch.getPerson("broken")).toBeUndefined();
  });

  it("reads availability for several people in one call", async () => {
    es.mget.mockResolvedValueOnce({ docs: [{ _id: "p_test", found: true, _source: { person } }, { _id: "nobody", found: false }] });
    expect(await elasticSearch.getAvailability(["p_test", "nobody"])).toEqual({ p_test: [slot], nobody: [] });
    expect(es.mget).toHaveBeenCalledTimes(1);
    expect(await elasticSearch.getAvailability([])).toEqual({});
    expect(es.mget).toHaveBeenCalledTimes(1);
  });
});

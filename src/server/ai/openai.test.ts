import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { people } from "@/contracts/fixtures";
import type { RefinedAsk } from "@/contracts/types";
import type { Candidate } from "@/server/search";

const { create, moderate, query } = vi.hoisted(() => ({ create: vi.fn(), moderate: vi.fn(), query: vi.fn() }));
vi.mock("openai", () => ({ default: class { responses = { create }; moderations = { create: moderate }; } }));
vi.mock("@neondatabase/serverless", async (importOriginal) => ({
  ...await importOriginal<typeof import("@neondatabase/serverless")>(), neon: () => ({ query }),
}));

import { AskBlockedError } from "./blocked";
import { openAi } from "./openai";
import { whyThem } from "./canned";

const requester = people[0];
const ask: RefinedAsk = { text: "How does the Kubernetes scheduler pick pods to preempt?", type: "knowledge", minutes: 5 };
const reply = (value: unknown, extra: object = {}) => ({
  id: "resp_1", model: "gpt-5.4-mini-2026-03-17", status: "completed", output_text: JSON.stringify(value),
  usage: { input_tokens: 120, output_tokens: 30 }, ...extra,
});
/** The line for a card without evidence: what they share with the question, or their bio (see whyThem). */
const noEvidence = whyThem(ask.text, requester, []);
const card = (id: string, highlights: string[]): Candidate => ({ person: { ...requester, id }, highlights, evidence: [], score: 1 });
const statements = (verb: "select" | "insert") =>
  query.mock.calls.filter(([text]) => String(text).toLowerCase().startsWith(verb));
/** The cache holds these values for the first keys a lookup asks for, in order. */
const cacheHolds = (...values: unknown[]) =>
  query.mockImplementation(async (text: string, params: string[]) =>
    ({ rows: text.toLowerCase().startsWith("select") ? values.map((value, i) => [params[i], value]) : [] }));
const sentPeople = () => JSON.parse(create.mock.calls[0][0].input).people;

beforeEach(() => {
  create.mockReset();
  moderate.mockReset().mockResolvedValue({ results: [{ flagged: false }] });
  query.mockReset().mockResolvedValue({ rows: [] });
  vi.stubEnv("DATABASE_URL", "postgresql://unused:unused@example.invalid/unused");
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("refineAsk", () => {
  const modelReply = { text: ask.text, type: ask.type };

  it("asks the model once with a strict schema, then caches the reply", async () => {
    create.mockResolvedValueOnce(reply(modelReply));

    await expect(openAi.refineAsk("  k8s preemption?  ", requester)).resolves.toEqual(ask);

    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0][0]).toMatchObject({
      model: "gpt-5.4-mini", input: "k8s preemption?", store: false, reasoning: { effort: "none" },
      text: { format: { type: "json_schema", name: "refined_ask", strict: true } },
    });
    expect(moderate).toHaveBeenCalledWith({ model: "omni-moderation-latest", input: "k8s preemption?" }, { timeout: 3000, maxRetries: 1 });
    expect(statements("insert")).toHaveLength(1);
    expect(statements("insert")[0][1]).toEqual(expect.arrayContaining(["refine", JSON.stringify(modelReply)]));
  });

  it("answers a repeat from the cache without calling the model", async () => {
    cacheHolds(modelReply);

    await expect(openAi.refineAsk("k8s preemption?", requester)).resolves.toEqual(ask);

    expect(create).not.toHaveBeenCalled();
    expect(moderate).not.toHaveBeenCalled();
    expect(statements("insert")).toHaveLength(0);
  });

  it("blocks an ask that moderation flags with a 422, and caches the verdict", async () => {
    moderate.mockResolvedValueOnce({ results: [{ flagged: true }] });
    create.mockRejectedValueOnce(new Error("The model refused too")); // moderation's verdict still wins

    const error = await openAi.refineAsk("something hateful", requester).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AskBlockedError);
    expect(error).toMatchObject({ status: 422 });
    expect(statements("insert")).toHaveLength(1);
    expect(statements("insert")[0][1]).toEqual(expect.arrayContaining(["refine", JSON.stringify({ blocked: true })]));
  });

  it("blocks a repeat from the cache without calling OpenAI", async () => {
    cacheHolds({ blocked: true });

    await expect(openAi.refineAsk("something hateful", requester)).rejects.toBeInstanceOf(AskBlockedError);

    expect(create).not.toHaveBeenCalled();
    expect(moderate).not.toHaveBeenCalled();
  });

  it("suggests a 5-minute chat whatever the kind of ask", async () => {
    create.mockResolvedValueOnce(reply({ text: "Would you be open to an SRE role working with Argo?", type: "hiring" }));
    create.mockResolvedValueOnce(reply({ text: "What does Grafana Labs look for in candidates?", type: "career" }));

    await expect(openAi.refineAsk("hiring SREs who know argo", requester)).resolves.toMatchObject({ type: "hiring", minutes: 5 });
    await expect(openAi.refineAsk("I want a job at Grafana Labs", requester)).resolves.toMatchObject({ type: "career", minutes: 5 });
  });

  it("rejects a reply that is blank or cut off, and caches neither", async () => {
    create.mockResolvedValueOnce(reply({ ...modelReply, text: "   " }));
    await expect(openAi.refineAsk("k8s?", requester)).rejects.toThrow();

    create.mockResolvedValueOnce(reply(modelReply, { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } }));
    await expect(openAi.refineAsk("k8s?", requester)).rejects.toThrow("incomplete: max_output_tokens");

    expect(statements("insert")).toHaveLength(0);
  });

  it("still refines when the cache is down", async () => {
    query.mockRejectedValue(new Error("Neon is down"));
    create.mockResolvedValueOnce(reply(modelReply));

    await expect(openAi.refineAsk("k8s?", requester)).resolves.toEqual(ask);
  });

  it("refuses an ask while moderation is down, caches nothing, and checks the retry", async () => {
    moderate.mockRejectedValueOnce(new Error("Moderation timed out"));
    create.mockResolvedValue(reply(modelReply)); // the model answers both times

    await expect(openAi.refineAsk("k8s?", requester)).rejects.toThrow("Moderation timed out");
    expect(statements("insert")).toHaveLength(0);

    await expect(openAi.refineAsk("k8s?", requester)).resolves.toEqual(ask);
    expect(moderate).toHaveBeenCalledTimes(2);
    expect(statements("insert")).toHaveLength(1);
  });
});

describe("moderate", () => {
  it("lets a clean ask through after one moderation call, without the model, and caches the verdict", async () => {
    await expect(openAi.moderate("  how does Raft leader election work?  ")).resolves.toBeUndefined();
    expect(moderate).toHaveBeenCalledWith({ model: "omni-moderation-latest", input: "how does Raft leader election work?" }, { timeout: 3000, maxRetries: 1 });
    expect(create).not.toHaveBeenCalled();
    expect(statements("insert")[0][1]).toEqual(expect.arrayContaining(["moderate", JSON.stringify({ blocked: false })]));
  });

  it("blocks a flagged ask with a 422 and caches that verdict", async () => {
    moderate.mockResolvedValueOnce({ results: [{ flagged: true }] });
    const error = await openAi.moderate("something hateful").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AskBlockedError);
    expect(error).toMatchObject({ status: 422 });
    expect(statements("insert")[0][1]).toEqual(expect.arrayContaining(["moderate", JSON.stringify({ blocked: true })]));
  });

  it("answers a repeat from the cache without calling OpenAI", async () => {
    cacheHolds({ blocked: false });
    await expect(openAi.moderate("k8s preemption?")).resolves.toBeUndefined();
    cacheHolds({ blocked: true });
    await expect(openAi.moderate("something hateful")).rejects.toBeInstanceOf(AskBlockedError);
    expect(moderate).not.toHaveBeenCalled();
  });

  it("rethrows when moderation is down, and caches nothing", async () => {
    moderate.mockRejectedValueOnce(new Error("Moderation timed out"));
    await expect(openAi.moderate("k8s?")).rejects.toThrow("Moderation timed out");
    expect(statements("insert")).toHaveLength(0);
  });

  it("still checks the ask when the cache is down", async () => {
    query.mockRejectedValue(new Error("Neon is down"));
    await expect(openAi.moderate("k8s?")).resolves.toBeUndefined();
    expect(moderate).toHaveBeenCalledOnce();
  });
});

describe("explain", () => {
  it("explains and rates every uncached card in one call, in card order, and caches each judgement", async () => {
    const cards = [card("a", ["kube-scheduler: preemption"]), card("b", []), card("c", ["sched-sim: a simulator"])];
    create.mockResolvedValueOnce(reply({ lines: [
      { ref: 2, why: "Built a scheduler simulator.", fit: "partial" },
      { ref: 1, why: "Maintains kube-scheduler preemption.", fit: "strong" },
    ] }));

    await expect(openAi.explain(ask, cards)).resolves.toEqual([
      { why: "Maintains kube-scheduler preemption.", fit: "strong" },
      { why: noEvidence }, // no evidence: never judged, never dropped
      { why: "Built a scheduler simulator.", fit: "partial" },
    ]);

    expect(create).toHaveBeenCalledOnce();
    expect(JSON.parse(create.mock.calls[0][0].input)).toEqual({
      question: ask.text,
      type: ask.type,
      people: [{ ref: 1, evidence: ["kube-scheduler: preemption"] }, { ref: 2, evidence: ["sched-sim: a simulator"] }],
    });
    expect(create.mock.calls[0][0].text.format.schema.properties.lines.items.properties.fit).toEqual({ type: "string", enum: ["strong", "partial", "none"] });
    expect(create.mock.calls[0][1]).toEqual({ timeout: 4000, maxRetries: 0 });
    expect(statements("insert")).toHaveLength(1);
    expect(statements("insert")[0][1]).toEqual(expect.arrayContaining([
      JSON.stringify({ why: "Maintains kube-scheduler preemption.", fit: "strong" }),
      JSON.stringify({ why: "Built a scheduler simulator.", fit: "partial" }),
    ]));
  });

  it("sends only cache misses, once per distinct evidence", async () => {
    cacheHolds({ why: "Cached line for a.", fit: "none" });
    create.mockResolvedValueOnce(reply({ lines: [{ ref: 1, why: "Line for y.", fit: "partial" }] }));

    await expect(openAi.explain(ask, [card("a", ["x"]), card("b", ["y"]), card("c", ["y"])])).resolves.toEqual([
      { why: "Cached line for a.", fit: "none" }, { why: "Line for y.", fit: "partial" }, { why: "Line for y.", fit: "partial" },
    ]);

    expect(statements("select")).toHaveLength(1);
    expect(sentPeople()).toEqual([{ ref: 1, evidence: ["y"] }]);
  });

  it("asks again for a cached plain line from before fit ratings existed", async () => {
    cacheHolds("Old line without a fit.");
    create.mockResolvedValueOnce(reply({ lines: [{ ref: 1, why: "New line.", fit: "strong" }] }));
    await expect(openAi.explain(ask, [card("a", ["x"])])).resolves.toEqual([{ why: "New line.", fit: "strong" }]);
  });

  it("never fails a match: on a model error every card keeps its evidence line, unjudged", async () => {
    create.mockRejectedValueOnce(new Error("Request timed out."));

    await expect(openAi.explain(ask, [card("a", ["kube-scheduler: preemption"])]))
      .resolves.toEqual([{ why: "kube-scheduler: preemption." }]);

    expect(statements("insert")).toHaveLength(0);
  });

  it("keeps the evidence line for a card the model skipped or answered badly", async () => {
    create.mockResolvedValueOnce(reply({ lines: [
      { ref: 1, why: "   ", fit: "none" }, { ref: 2, why: "x".repeat(201), fit: "none" }, { ref: 9, why: "Stray.", fit: "strong" },
    ] }));

    await expect(openAi.explain(ask, [card("a", ["x"]), card("b", ["y"])]))
      .resolves.toEqual([{ why: "x." }, { why: "y." }]);

    expect(statements("insert")).toHaveLength(0);
  });

  it("calls nothing for an empty list or cards without evidence", async () => {
    await expect(openAi.explain(ask, [])).resolves.toEqual([]);
    await expect(openAi.explain(ask, [card("b", [])])).resolves.toEqual([{ why: noEvidence }]);

    expect(query).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});

/**
 * The background first match from createAsk, with the real pipeline, search fake and explanation
 * code. Only OpenAI, Postgres and Next's after() are replaced, so the tests show whether the
 * asker's own first match reuses what the warm-up cached, and what happens when it doesn't.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_USER_A, people, sampleAsks } from "@/contracts/fixtures";

const { query, create, moderate, afterTasks, config } = vi.hoisted(() => ({
  query: vi.fn(), create: vi.fn(), moderate: vi.fn(), afterTasks: [] as (() => Promise<unknown>)[],
  config: { fakeApi: false, fakeSearch: true, fakeAi: false, batchRejectAfter: 3, slotLockoutMinutes: 60, maxSlots: 3 },
}));
vi.mock("@/server/config", () => ({ config }));
vi.mock("openai", () => ({ default: class { responses = { create }; moderations = { create: moderate }; } }));
vi.mock("@neondatabase/serverless", async (importOriginal) => ({
  ...await importOriginal<typeof import("@neondatabase/serverless")>(), neon: () => ({ query }),
}));
vi.mock("next/server", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/server")>(),
  after: (task: () => Promise<unknown>) => { afterTasks.push(task); },
}));
vi.mock("@/server/profile/service", () => ({ getProfile: async (id: string) => people.find((person) => person.id === id) }));

import { createAsk, matchAsk } from "./asks";

type ModelRequest = { input: string; text: { format: { name: string } } };
const reply = (value: unknown) =>
  ({ id: "resp_1", model: "gpt-5.4-mini", status: "completed", output_text: JSON.stringify(value), usage: { input_tokens: 1, output_tokens: 1 } });
const answer = async (request: ModelRequest) => {
  if (request.text.format.name === "refined_ask") return reply({ text: "How does preemption work in the Kubernetes scheduler?", type: "knowledge" });
  const { people: sent } = JSON.parse(request.input) as { people: { ref: number }[] };
  return reply({ lines: sent.map(({ ref }) => ({ ref, why: `Explained card ${ref}.`, fit: "strong" })) });
};
const explainCalls = () => create.mock.calls.filter(([request]) => request.text.format.name === "explanations").length;
const aiLinesOnEveryCardWithEvidence = (cards: { highlights: string[]; explanation: string }[]) => {
  const explained = cards.filter((card) => card.highlights.length);
  return explained.length > 0 && explained.every((card) => card.explanation.startsWith("Explained card"));
};

/** Postgres, as far as these calls use it: asks, no passes or requests yet, profiles and ai_cache. */
function database() {
  const cache = new Map<string, unknown>();
  const asks = new Map<string, unknown[]>();
  query.mockImplementation(async (sql: string, params: unknown[]) => {
    if (sql.includes(" union ") || sql.includes('from "rejections"') || sql.includes('from "requests"')) return { rows: [] };
    if (sql.startsWith('insert into "ai_cache"')) {
      for (let i = 0; i < params.length; i += 3) cache.set(String(params[i]), JSON.parse(String(params[i + 2])));
      return { rows: [] };
    }
    if (sql.includes('from "ai_cache"')) {
      return { rows: params.filter((key) => cache.has(String(key))).map((key) => [key, cache.get(String(key))]) };
    }
    if (sql.startsWith('insert into "asks"')) {
      asks.set(String(params[0]), [...params.slice(0, 4), "open", true, "2026-11-09T09:00:00.000Z"]);
      return { rows: [] };
    }
    if (sql.includes('from "asks"')) return { rows: asks.has(String(params[0])) ? [asks.get(String(params[0]))] : [] };
    if (sql.includes('from "users"')) return { rows: people.map((person) => [person.id, JSON.stringify(person.visibility), false]) };
    throw new Error(`Unexpected query: ${sql}`);
  });
}

beforeEach(() => {
  afterTasks.length = 0;
  database();
  moderate.mockReset().mockResolvedValue({ results: [{ flagged: false }] });
  create.mockReset().mockImplementation(answer);
  vi.stubEnv("DATABASE_URL", "postgresql://unused:unused@example.invalid/unused");
});

describe("the background first match", () => {
  it("leaves the asker's first match nothing to explain once it has finished", async () => {
    const { askId } = await createAsk(DEMO_USER_A, sampleAsks[0].raw);
    expect(explainCalls()).toBe(0); // nothing runs before the response
    await afterTasks[0]();
    expect(explainCalls()).toBe(1);

    const cards = await matchAsk(DEMO_USER_A, askId);

    expect(explainCalls()).toBe(1); // every line came from ai_cache
    expect(aiLinesOnEveryCardWithEvidence(cards)).toBe(true);
  });

  it("if the asker opens results first, both explain the same cards: same lines, one extra paid call", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    create.mockImplementation(async (request: ModelRequest) => {
      if (request.text.format.name === "explanations") await gate; // both have read the empty cache by now
      return answer(request);
    });
    const { askId } = await createAsk(DEMO_USER_A, sampleAsks[0].raw);

    const warmUp = afterTasks[0]();
    const asker = matchAsk(DEMO_USER_A, askId);
    await vi.waitFor(() => expect(explainCalls()).toBe(2));
    release();

    const [, cards] = await Promise.all([warmUp, asker]);
    expect(aiLinesOnEveryCardWithEvidence(cards)).toBe(true);
  });
});

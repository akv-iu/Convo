import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { people } from "@/contracts/fixtures";
import { routes } from "@/contracts/routes";
import type { Ask } from "@/contracts/types";

const { query, getProfile, refineAsk, registerAsk, runMatch } = vi.hoisted(() => ({
  query: vi.fn(), getProfile: vi.fn(), refineAsk: vi.fn(), registerAsk: vi.fn(), runMatch: vi.fn(),
}));
vi.mock("@neondatabase/serverless", async (importOriginal) => ({
  ...await importOriginal<typeof import("@neondatabase/serverless")>(), neon: () => ({ query }),
}));
vi.mock("@/server/profile/service", () => ({ getProfile }));
vi.mock("@/server/ai", () => ({ ai: { refineAsk } }));
vi.mock("@/server/search", () => ({ search: { registerAsk } }));
vi.mock("@/server/pipeline", () => ({ runMatch }));
import { createAsk, matchAsk } from "./asks";

const person = people[0];
const refined = { text: "How does scheduler preemption work?", type: "knowledge" as const, minutes: 10 };
const ask: Ask = {
  id: "saved-ask", userId: person.id, rawText: "scheduler preemption", refined,
  status: "open", softBlocker: true, createdAt: "2026-11-05T12:00:00.000Z",
};
function askRows(value: Ask = ask) {
  return { rows: [[value.id, value.userId, value.rawText, JSON.stringify(value.refined), value.status, value.softBlocker, value.createdAt]] };
}
beforeEach(() => {
  query.mockReset().mockResolvedValue({ rows: [] });
  getProfile.mockReset().mockResolvedValue(person);
  refineAsk.mockReset().mockResolvedValue(refined);
  registerAsk.mockReset().mockResolvedValue(undefined);
  runMatch.mockReset().mockResolvedValue([]);
  vi.stubEnv("DATABASE_URL", "postgresql://unused:unused@example.invalid/unused");
});
afterEach(() => vi.unstubAllEnvs());

describe("durable ask creation", () => {
  it("saves a new ask under its owner before registering its refined text", async () => {
    registerAsk.mockImplementationOnce(async () => {
      expect(query).toHaveBeenCalledOnce();
    });
    const response = await createAsk(person.id, "scheduler preemption");
    expect(routes.refine.response.parse(response)).toEqual({ askId: expect.any(String), refined });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('insert into "asks"');
    expect(params).toEqual([response.askId, person.id, "scheduler preemption", JSON.stringify(refined)]);
    expect(refineAsk).toHaveBeenCalledWith("scheduler preemption", person);
    expect(registerAsk).toHaveBeenCalledWith(response.askId, person.id, refined.text);
  });

  it("uses a distinct ID for each intentional submission", async () => {
    expect((await createAsk(person.id, "scheduler preemption")).askId)
      .not.toBe((await createAsk(person.id, "scheduler preemption")).askId);
  });

  it("rejects whitespace-only text before calling dependencies", async () => {
    await expect(createAsk(person.id, "   ")).rejects.toMatchObject({ status: 400 });
    expect(getProfile).not.toHaveBeenCalled();
    expect(refineAsk).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it("requires a completed profile before AI or storage writes", async () => {
    getProfile.mockRejectedValueOnce(Object.assign(new Error("Complete onboarding first"), { status: 409 }));
    await expect(createAsk(person.id, "scheduler preemption")).rejects.toMatchObject({ status: 409 });
    expect(refineAsk).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it.each([{ ...refined, minutes: 0 }, { ...refined, type: "invalid" }, { ...refined, text: " " }])(
    "does not persist an invalid AI reply", async (value) => {
      refineAsk.mockResolvedValueOnce(value);
      await expect(createAsk(person.id, "scheduler preemption")).rejects.toMatchObject({ status: 503 });
      expect(query).not.toHaveBeenCalled();
      expect(registerAsk).not.toHaveBeenCalled();
    },
  );

  it("sanitizes AI failures", async () => {
    refineAsk.mockRejectedValueOnce(new Error("private-provider-key"));
    const error = await createAsk(person.id, "scheduler preemption").catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 503 });
    expect(String(error)).not.toContain("private-provider-key");
    expect(query).not.toHaveBeenCalled();
  });

  it("never registers a question that failed to save", async () => {
    query.mockRejectedValueOnce(new Error("private-database-url"));
    const error = await createAsk(person.id, "scheduler preemption").catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 503 });
    expect(String(error)).not.toContain("private-database-url");
    expect(registerAsk).not.toHaveBeenCalled();
  });

  it("reports the saved ID when search registration fails, without deleting the ask or retrying", async () => {
    registerAsk.mockRejectedValueOnce(new Error("private-search-token"));
    const error = await createAsk(person.id, "scheduler preemption").catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 503 });
    expect(String(error)).toContain(query.mock.calls[0][1][0]);
    expect(String(error)).toMatch(/saved/i);
    expect(String(error)).not.toContain("private-search-token");
    expect(query).toHaveBeenCalledOnce();
    expect(registerAsk).toHaveBeenCalledOnce();
  });
});

describe("matching a saved ask", () => {
  it("excludes pending imports before search and explanations even with the soft blocker off", async () => {
    query.mockResolvedValueOnce(askRows({ ...ask, softBlocker: false }))
      .mockResolvedValueOnce({ rows: [["rejected", 1]] }).mockResolvedValueOnce({ rows: [["pending-user"]] });
    await matchAsk(person.id, ask.id);
    expect(runMatch).toHaveBeenCalledWith(expect.objectContaining({ excludeIds: ["pending-user"] }));
    expect(query.mock.calls[2][1]).toEqual([true]);
  });
  it("withholds stale evidence and explanations until the owner's imported evidence is synchronized", async () => {
    const pending = { ...person, id: "pending-evidence", synthetic: false };
    const ready = { ...person, id: "ready-evidence", synthetic: false };
    const visible = { country: true, workplace: true, hiring: true };
    runMatch.mockResolvedValueOnce([pending, ready].map((candidate, rank) => ({ person: candidate,
      badges: [], highlights: ["Old repository"], mutual: false, explanation: "Old repository explanation", score: 1, rank })));
    query.mockResolvedValueOnce(askRows()).mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [
      [pending.id, JSON.stringify(visible), true], [ready.id, JSON.stringify(visible), false],
    ] });
    const cards = await matchAsk(person.id, ask.id);
    expect(cards.map(card => card.person.id)).toEqual([ready.id]);
  });
  it("uses current database visibility even when search contains an older public profile", async () => {
    query.mockResolvedValueOnce(askRows()).mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [["candidate", JSON.stringify({ country: false, workplace: false, hiring: false })]] });
    const candidate = { ...person, id: "candidate", synthetic: false, workplaceName: "Acme" };
    runMatch.mockResolvedValueOnce([{ person: candidate, badges: [candidate.filters.country, "hiring"], highlights: [], mutual: false, explanation: "Match", score: 1, rank: 0 }]);
    const [card] = await matchAsk(person.id, ask.id);
    expect(card.person.filters).toEqual({ country: null, rorId: null, hiring: null });
    expect(card.person.workplaceName).toBeNull();
    expect(card.badges).toEqual([]);
    expect(query.mock.calls[3][1]).toEqual(["candidate"]);
    expect(candidate.filters).toEqual(person.filters);
  });

  it("fails closed when a real candidate's current privacy cannot be loaded", async () => {
    query.mockResolvedValueOnce(askRows()).mockResolvedValueOnce({ rows: [] });
    runMatch.mockResolvedValueOnce([{ person: { ...person, synthetic: false }, badges: [], highlights: [], mutual: false, explanation: "Match", score: 1, rank: 0 }]);
    expect((await matchAsk(person.id, ask.id))[0].person.filters).toEqual({ country: null, rorId: null, hiring: null });
  });

  it("does not return cards when the current privacy read fails", async () => {
    query.mockResolvedValueOnce(askRows()).mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error("private-database-token"));
    runMatch.mockResolvedValueOnce([{ person, badges: [], highlights: [], mutual: false, explanation: "Match", score: 1, rank: 0 }]);
    const error = await matchAsk(person.id, ask.id).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 503 });
    expect(String(error)).not.toContain("private-database-token");
  });
  it("scopes the ask lookup to its owner and passes saved answers to the pipeline", async () => {
    query.mockResolvedValueOnce(askRows()).mockResolvedValueOnce({ rows: [] });
    expect(await matchAsk(person.id, ask.id, "raft")).toEqual([]);
    expect(query.mock.calls[0][0]).toContain('where ("asks"."id" = $1 and "asks"."user_id" = $2)');
    expect(query.mock.calls[0][1]).toEqual([ask.id, person.id, 1]);
    expect(runMatch).toHaveBeenCalledWith({ ask, requester: person, query: "raft", excludeIds: [], hiddenBelowRank: null });
  });

  it("hides existence of another user's or a missing ask", async () => {
    await expect(matchAsk("different-user", ask.id)).rejects.toMatchObject({ status: 404 });
    expect(query.mock.calls[0][1]).toEqual([ask.id, "different-user", 1]);
    expect(query).toHaveBeenCalledOnce();
    expect(getProfile).not.toHaveBeenCalled();
    expect(runMatch).not.toHaveBeenCalled();
  });

  it.each([true, false])("passes persisted exclusions and the batch cutoff with blocker=%s", async (softBlocker) => {
    query.mockResolvedValueOnce(askRows({ ...ask, softBlocker })).mockResolvedValueOnce({ rows: [["p1", 0], ["p2", 2], ["p3", 4]] });
    await matchAsk(person.id, ask.id);
    expect(query.mock.calls[1][1]).toEqual([ask.id]);
    expect(runMatch).toHaveBeenCalledWith(expect.objectContaining({
      excludeIds: softBlocker ? ["p1", "p2", "p3"] : [], hiddenBelowRank: 4,
    }));
  });

  it("does not impose the batch cutoff below the configured threshold", async () => {
    query.mockResolvedValueOnce(askRows()).mockResolvedValueOnce({ rows: [["p1", 4]] });
    await matchAsk(person.id, ask.id);
    expect(runMatch).toHaveBeenCalledWith(expect.objectContaining({ excludeIds: ["p1"], hiddenBelowRank: null }));
  });

  it("rejects invalid stored asks before the pipeline", async () => {
    query.mockResolvedValueOnce(askRows({ ...ask, refined: { ...refined, minutes: 0 } }));
    await expect(matchAsk(person.id, ask.id)).rejects.toMatchObject({ status: 503 });
    expect(runMatch).not.toHaveBeenCalled();
  });

  it("does not show possibly rejected people when exclusion storage fails", async () => {
    query.mockResolvedValueOnce(askRows()).mockRejectedValueOnce(new Error("private-db-password"));
    const error = await matchAsk(person.id, ask.id).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 503 });
    expect(String(error)).not.toContain("private-db-password");
    expect(runMatch).not.toHaveBeenCalled();
  });

  it("rejects corrupt exclusion ranks before the pipeline", async () => {
    query.mockResolvedValueOnce(askRows()).mockResolvedValueOnce({ rows: [["p1", -1]] });
    await expect(matchAsk(person.id, ask.id)).rejects.toMatchObject({ status: 503 });
    expect(runMatch).not.toHaveBeenCalled();
  });

  it("rejects an off-contract pipeline result", async () => {
    query.mockResolvedValueOnce(askRows()).mockResolvedValueOnce({ rows: [] });
    runMatch.mockResolvedValueOnce([{ person: { id: "missing-fields" } }]);
    await expect(matchAsk(person.id, ask.id)).rejects.toMatchObject({ status: 503 });
  });

  it("sanitizes database and pipeline failures", async () => {
    query.mockRejectedValueOnce(new Error("private-database-url"));
    const dbError = await matchAsk(person.id, ask.id).catch((e: unknown) => e);
    expect(dbError).toMatchObject({ status: 503 });
    expect(String(dbError)).not.toContain("private-database-url");
    query.mockResolvedValueOnce(askRows()).mockResolvedValueOnce({ rows: [] });
    runMatch.mockRejectedValueOnce(new Error("private-provider-key"));
    const pipelineError = await matchAsk(person.id, ask.id).catch((e: unknown) => e);
    expect(pipelineError).toMatchObject({ status: 503 });
    expect(String(pipelineError)).not.toContain("private-provider-key");
  });
});

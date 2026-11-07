import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_USER_A, DEMO_USER_B, people, sampleAsks } from "@/contracts/fixtures";
import { routes } from "@/contracts/routes";
import type { RefinedAsk } from "@/contracts/types";
import { store } from "@/contracts/fake/store";
import { search } from "@/server/search";

const { query, runtime, identity } = vi.hoisted(() => ({
  query: vi.fn(), identity: { userId: "u_demo_a" as string | null },
  runtime: { fakeApi: false, fakeSearch: true, fakeAi: true, batchRejectAfter: 3, slotLockoutMinutes: 60, maxSlots: 3 },
}));
vi.mock("@/server/config", () => ({ config: runtime }));
vi.mock("@/server/auth", () => ({ getUserId: async () => identity.userId }));
vi.mock("next/server", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/server")>(), connection: async () => undefined,
}));
vi.mock("@neondatabase/serverless", async (importOriginal) => ({
  ...await importOriginal<typeof import("@neondatabase/serverless")>(), neon: () => ({ query }),
}));
import { POST as refine } from "./route";
import { POST as match } from "../match/route";

const person = people[0];
const context = () => ({ params: Promise.resolve({}) });
const request = (path: string, body: unknown) => new Request(`http://localhost:3000/api/${path}`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
function profileRows() {
  return { rows: [[person.id, person.githubLogin, person.name, person.bio,
    JSON.stringify(person.languages), JSON.stringify(person.organisations), JSON.stringify(person.filters),
    JSON.stringify(person.freeTimes), "2026-11-05T12:00:00Z", 1, null, "sunflower", JSON.stringify(person.visibility), "[]", false]] };
}
function savedAskRows(askId: string, raw: string, refined: RefinedAsk) {
  return { rows: [[askId, person.id, raw, JSON.stringify(refined), "open", true, "2026-11-05T12:00:00Z"]] };
}
beforeEach(() => {
  runtime.fakeApi = false;
  identity.userId = DEMO_USER_A;
  store.reset();
  query.mockReset().mockResolvedValue({ rows: [] });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubEnv("DATABASE_URL", "postgresql://unused:unused@example.invalid/unused");
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Unexpected live request")));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe.each(["fake", "real"] as const)("%s ask HTTP contract", (mode) => {
  beforeEach(() => { runtime.fakeApi = mode === "fake"; });

  it.each(sampleAsks)("refines and matches the saved question: $raw", async (sample) => {
    query.mockResolvedValueOnce(profileRows()).mockResolvedValueOnce({ rows: [] });
    const response = await refine(request("refine", { text: sample.raw, userId: DEMO_USER_B, id: "forged-id" }), context());
    expect(response.status).toBe(200);
    const created = routes.refine.response.parse(await response.json());
    expect(created.askId).not.toBe("forged-id");
    expect(created.refined.text).toContain(sample.raw.replace(/[.?!]+$/, ""));
    if (mode === "real") {
      expect(query.mock.calls[1][1].slice(0, 3)).toEqual([created.askId, DEMO_USER_A, sample.raw]);
      store.reset(); // The real route must read the saved ask without relying on the demo store.
      query.mockResolvedValueOnce(savedAskRows(created.askId, sample.raw, created.refined))
        .mockResolvedValueOnce(profileRows()).mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: people.map(p => [p.id, JSON.stringify(p.visibility), false]) });
    }
    const matched = await match(request("match", { askId: created.askId }), context());
    expect(matched.status).toBe(200);
    const results = routes.match.response.parse(await matched.json());
    expect(results[0]?.person.id).toBe(sample.expectedTop);
    expect(results[0]?.highlights.length).toBeGreaterThan(0);
    expect(results.every((result) => result.person.id !== DEMO_USER_A)).toBe(true);
    if (mode === "fake") expect(query).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("requires sign-in for both endpoints", async () => {
    identity.userId = null;
    expect((await refine(request("refine", { text: "scheduler preemption" }), context())).status).toBe(401);
    expect((await match(request("match", { askId: "some-ask" }), context())).status).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects malformed payloads before storage", async () => {
    expect((await refine(request("refine", { text: "a" }), context())).status).toBe(400);
    expect((await match(request("match", {}), context())).status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it("returns404 for both nonexistent asks and another user's saved ask", async () => {
    expect((await match(request("match", { askId: "missing" }), context())).status).toBe(404);
    query.mockResolvedValueOnce(profileRows()).mockResolvedValueOnce({ rows: [] });
    const response = await refine(request("refine", { text: "scheduler preemption" }), context());
    const { askId } = routes.refine.response.parse(await response.json());
    identity.userId = DEMO_USER_B;
    const denied = await match(request("match", { askId }), context());
    expect(denied.status).toBe(404);
    if (mode === "real") expect(query.mock.calls.at(-1)?.[1]).toEqual([askId, DEMO_USER_B, 1]);
  });
});

describe("real ask route failures", () => {
  it("returns a saved ask during registration failure and repairs its reverse count on match", async () => {
    const raw = `${sampleAsks[0].raw} RecoveryQuasarToken`;
    const recipient = { ...person, id: "recovery-count-target", bio: "RecoveryQuasarToken" };
    const registration = vi.spyOn(search, "registerAsk");
    registration.mockRejectedValueOnce(new Error("private-search-token"));
    query.mockResolvedValueOnce(profileRows()).mockResolvedValueOnce({ rows: [] });
    const created = await refine(request("refine", { text: raw }), context());
    expect(created.status).toBe(200);
    const { askId: savedId, refined: savedRefined } = routes.refine.response.parse(await created.json());
    expect(savedId).toBe(query.mock.calls[1][1][0]);
    expect(await search.whoIsLookingFor(recipient)).toEqual([]);
    for (const attempt of [1, 2]) {
      query.mockResolvedValueOnce(savedAskRows(savedId, raw, savedRefined))
        .mockResolvedValueOnce(profileRows()).mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: people.map(p => [p.id, JSON.stringify(p.visibility), false]) });
      const recovered = await match(request("match", { askId: savedId }), context());
      expect(recovered.status, `attempt ${attempt}`).toBe(200);
      expect(routes.match.response.parse(await recovered.json())[0].person.id).toBe(sampleAsks[0].expectedTop);
      expect(await search.whoIsLookingFor(recipient)).toEqual([person.id]);
    }
    expect(registration).toHaveBeenLastCalledWith(savedId, person.id, savedRefined.text);
    expect(query.mock.calls.filter(([sql]) => String(sql).startsWith("insert"))).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled();
    await search.removeAsk(savedId);
  });

  it("returns match cards even when search registration fails again", async () => {
    vi.spyOn(search, "registerAsk").mockRejectedValueOnce(new Error("private-search-token"));
    const refined = { text: sampleAsks[0].raw, type: "knowledge" as const, minutes: 10 };
    query.mockResolvedValueOnce(savedAskRows("replay-failure", sampleAsks[0].raw, refined))
      .mockResolvedValueOnce(profileRows()).mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: people.map(p => [p.id, JSON.stringify(p.visibility), false]) });
    const response = await match(request("match", { askId: "replay-failure" }), context());
    expect(response.status).toBe(200);
    expect(routes.match.response.parse(await response.json())[0].person.id).toBe(sampleAsks[0].expectedTop);
    expect(console.warn).toHaveBeenCalledOnce();
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain("private-search-token");
  });

  it("rejects whitespace-only questions without touching storage", async () => {
    const response = await refine(request("refine", { text: "   " }), context());
    expect(response.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it("does not leak database errors", async () => {
    query.mockRejectedValueOnce(new Error("private-db-password"));
    const response = await match(request("match", { askId: "some-ask" }), context());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private-db-password");
  });
});

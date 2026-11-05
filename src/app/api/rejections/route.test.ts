import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_USER_A, DEMO_USER_B, people } from "@/contracts/fixtures";
import { routes } from "@/contracts/routes";
import type { Ask } from "@/contracts/types";
import { store } from "@/contracts/fake/store";

const { query, runtime, identity } = vi.hoisted(() => ({
  query: vi.fn(), identity: { userId: "u_demo_a" as string | null },
  runtime: { fakeApi: false, fakeSearch: true, fakeAi: true, batchRejectAfter: 3, slotLockoutMinutes: 60, maxSlots: 3 },
}));
vi.mock("@/server/config", () => ({ config: runtime }));
vi.mock("@/server/auth", () => ({ getUserId: async () => identity.userId }));
vi.mock("@/server/profile/service", () => ({ getProfile: async () => people[0] }));
vi.mock("next/server", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/server")>(), connection: async () => undefined,
}));
vi.mock("@neondatabase/serverless", async (importOriginal) => ({
  ...await importOriginal<typeof import("@neondatabase/serverless")>(), neon: () => ({ query }),
}));
import { POST as reject } from "./route";
import { PUT as setBlocker } from "../soft-blocker/route";
import { POST as match } from "../match/route";

const ask: Ask = {
  id: "saved-ask", userId: DEMO_USER_A, rawText: "kubernetes scheduling preemption etcd raft argo gitops", refined: null,
  status: "open", softBlocker: true, createdAt: "2026-11-05T12:00:00.000Z",
};
const context = () => ({ params: Promise.resolve({}) });
const request = (path: string, body: unknown) => new Request(`http://localhost:3000/api/${path}`, {
  method: path === "soft-blocker" ? "PUT" : "POST",
  headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
beforeEach(() => {
  runtime.fakeApi = false;
  identity.userId = DEMO_USER_A;
  store.reset();
  store.get().asks.set(ask.id, { ...ask });
  query.mockReset().mockResolvedValue({ rows: [] });
  vi.stubEnv("DATABASE_URL", "postgresql://unused:unused@example.invalid/unused");
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Unexpected live request")));
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe.each(["fake", "real"] as const)("%s rejection HTTP contract", (mode) => {
  beforeEach(() => { runtime.fakeApi = mode === "fake"; });

  it("persists rejection and switch choices, then applies them through the actual match pipeline", async () => {
    if (mode === "real") store.reset(); // Real writes and matching must not depend on the demo store.
    const rejected: [string, number][] = [];
    let blocker = true;
    async function matches() {
      if (mode === "real") {
        query.mockResolvedValueOnce({ rows: [[ask.id, ask.userId, ask.rawText, null, "open", blocker, ask.createdAt]] })
          .mockResolvedValueOnce({ rows: [...rejected] });
      }
      const response = await match(request("match", { askId: ask.id }), context());
      expect(response.status).toBe(200);
      return routes.match.response.parse(await response.json());
    }
    async function rejectCandidate(personId: string, rank: number) {
      rejected.push([personId, rank]);
      if (mode === "real") query.mockResolvedValueOnce({ rows: [["new-rejection"]] }).mockResolvedValueOnce({ rows: [...rejected] });
      const response = await reject(request("rejections", { askId: ask.id, personId, rank, userId: DEMO_USER_B }), context());
      expect(response.status).toBe(200);
      return routes.reject.response.parse(await response.json());
    }
    async function toggle(enabled: boolean) {
      blocker = enabled;
      if (mode === "real") query.mockResolvedValueOnce({ rows: [[ask.id, enabled]] });
      const response = await setBlocker(request("soft-blocker", { askId: ask.id, enabled }), context());
      expect(response.status).toBe(200);
      expect(routes.setSoftBlocker.response.parse(await response.json())).toEqual({ askId: ask.id, enabled });
    }

    const original = await matches();
    expect(original.length).toBeGreaterThanOrEqual(4);
    const first = original[0];
    expect(await rejectCandidate(first.person.id, first.rank)).toEqual({ rejections: 1, hiddenBelowRank: null });
    expect((await matches()).some(({ person }) => person.id === first.person.id)).toBe(false);
    await toggle(false);
    expect((await matches()).map(({ person }) => person.id)).toEqual(original.map(({ person }) => person.id));
    await toggle(true);
    expect((await matches()).some(({ person }) => person.id === first.person.id)).toBe(false);
    expect(await rejectCandidate(original[1].person.id, original[1].rank)).toEqual({ rejections: 2, hiddenBelowRank: null });
    expect(await rejectCandidate(original[2].person.id, original[2].rank)).toEqual({ rejections: 3, hiddenBelowRank: 2 });
    const remaining = await matches();
    expect(remaining.length).toBeGreaterThan(0);
    expect(remaining.length).toBeLessThanOrEqual(2);
    expect(remaining.every(({ person, rank }) => !rejected.some(([id]) => id === person.id) && rank < 2)).toBe(true);
    await toggle(false);
    expect((await matches()).map(({ person }) => person.id)).toEqual(original.slice(0, 2).map(({ person }) => person.id));
    if (mode === "fake") expect(query).not.toHaveBeenCalled();
  });

  it("returns401 without writing valid payloads when signed out", async () => {
    identity.userId = null;
    expect((await reject(request("rejections", { askId: ask.id, personId: DEMO_USER_B, rank: 0 }), context())).status).toBe(401);
    expect((await setBlocker(request("soft-blocker", { askId: ask.id, enabled: false }), context())).status).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });

  it("counts repeated submissions as events and honors a zero cutoff even with the blocker off", async () => {
    const rejected = { personId: DEMO_USER_B, rank: 0 };
    store.get().rejections.set(ask.id, [rejected, rejected]);
    store.get().asks.get(ask.id)!.softBlocker = false;
    if (mode === "real") query.mockResolvedValueOnce({ rows: [["new-rejection"]] })
      .mockResolvedValueOnce({ rows: Array.from({ length: 3 }, () => [DEMO_USER_B, 0]) });
    const response = await reject(request("rejections", { askId: ask.id, ...rejected }), context());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ rejections: 3, hiddenBelowRank: 0 });
    if (mode === "real") query.mockResolvedValueOnce({ rows: [[ask.id, ask.userId, ask.rawText, null, "open", false, ask.createdAt]] })
      .mockResolvedValueOnce({ rows: Array.from({ length: 3 }, () => [DEMO_USER_B, 0]) });
    const matched = await match(request("match", { askId: ask.id }), context());
    expect(matched.status).toBe(200);
    expect(await matched.json()).toEqual([]);
  });

  it.each([-1, 1.5, "2", null])("rejects invalid rank %s before storage", async (rank) => {
    expect((await reject(request("rejections", { askId: ask.id, personId: DEMO_USER_B, rank }), context())).status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects invalid switch values before storage", async () => {
    expect((await setBlocker(request("soft-blocker", { askId: ask.id, enabled: "false" }), context())).status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it.each(["missing-ask", ask.id])("returns404 for nonexistent or foreign-owned ask %s", async (askId) => {
    identity.userId = DEMO_USER_B;
    expect((await reject(request("rejections", { askId, personId: "p1", rank: 0, userId: DEMO_USER_A }), context())).status).toBe(404);
    expect((await setBlocker(request("soft-blocker", { askId, enabled: false, userId: DEMO_USER_A }), context())).status).toBe(404);
    if (mode === "real") {
      expect(query.mock.calls[0][1].slice(-2)).toEqual([askId, DEMO_USER_B]);
      expect(query.mock.calls[1][1]).toEqual([false, askId, DEMO_USER_B]);
    }
    expect(store.get().asks.get(ask.id)?.softBlocker).toBe(true);
    expect(store.get().rejections.size).toBe(0);
  });
});

it("returns sanitized503 on database failures for both real write routes", async () => {
  query.mockRejectedValue(new Error("private-db-password"));
  const rejection = await reject(request("rejections", { askId: ask.id, personId: "p1", rank: 0 }), context());
  const blocker = await setBlocker(request("soft-blocker", { askId: ask.id, enabled: false }), context());
  for (const response of [rejection, blocker]) {
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private-db-password");
  }
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_USER_A, DEMO_USER_B } from "@/contracts/fixtures";
import { routes } from "@/contracts/routes";
import { store } from "@/contracts/fake/store";
import type { Ask } from "@/contracts/types";

const { query, identity, runtime, removeAsk } = vi.hoisted(() => ({
  query: vi.fn(), removeAsk: vi.fn(), identity: { userId: "u_demo_a" as string | null },
  runtime: { fakeApi: false, fakeSearch: true, fakeAi: true },
}));
vi.mock("@/server/config", () => ({ config: runtime }));
vi.mock("@/server/auth", () => ({ getUserId: async () => identity.userId }));
vi.mock("@/server/search", () => ({ search: { removeAsk } }));
vi.mock("@neondatabase/serverless", async importOriginal => ({
  ...await importOriginal<typeof import("@neondatabase/serverless")>(), neon: () => ({ query }),
}));
vi.mock("next/server", async importOriginal => ({
  ...await importOriginal<typeof import("next/server")>(), connection: async () => undefined,
}));
import { POST } from "./route";

const ask: Ask = { id: "resolve-http", userId: DEMO_USER_A, rawText: "scheduler", refined: null,
  status: "open", softBlocker: true, createdAt: "2026-11-05T12:00:00.000Z" };
const invoke = (id = ask.id) => POST(new Request(`http://localhost:3000/api/asks/${id}/resolve`, { method: "POST" }), { params: Promise.resolve({ id }) });
beforeEach(() => {
  identity.userId = DEMO_USER_A;
  store.reset();
  store.get().asks.set(ask.id, { ...ask });
  query.mockReset().mockResolvedValue({ rows: [] });
  removeAsk.mockReset().mockResolvedValue(undefined);
  vi.stubEnv("DATABASE_URL", "postgresql://unused:unused@example.invalid/unused");
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Unexpected live call")));
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe.each(["fake", "real"] as const)("%s resolution HTTP contract", mode => {
  beforeEach(() => { runtime.fakeApi = mode === "fake"; });
  it("returns a resolved ask and allows an identical retry", async () => {
    query.mockResolvedValue({ rows: [[ask.id, ask.userId, ask.rawText, null, "resolved", true, ask.createdAt]] });
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await invoke();
      expect(response.status).toBe(200);
      expect(routes.resolve.response.parse(await response.json())).toEqual({ ...ask, status: "resolved" });
    }
    expect(removeAsk).toHaveBeenCalledTimes(2);
    if (mode === "fake") expect(query).not.toHaveBeenCalled();
    else expect(query.mock.calls[0][1]).toEqual(["resolved", ask.id, DEMO_USER_A]);
  });
  it("requires sign-in before storage or search", async () => {
    identity.userId = null;
    expect((await invoke()).status).toBe(401);
    expect(query).not.toHaveBeenCalled();
    expect(removeAsk).not.toHaveBeenCalled();
  });
  it("returns the same 404 for missing and foreign asks", async () => {
    expect((await invoke("missing")).status).toBe(404);
    identity.userId = DEMO_USER_B;
    expect((await invoke()).status).toBe(404);
    expect(removeAsk).not.toHaveBeenCalled();
  });
});

it("returns a safe, retryable error after a real search failure", async () => {
  runtime.fakeApi = false;
  query.mockResolvedValue({ rows: [[ask.id, ask.userId, ask.rawText, null, "resolved", true, ask.createdAt]] });
  removeAsk.mockRejectedValueOnce(new Error("private-search-token"));
  const response = await invoke();
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "Ask resolved, but search update failed. Retry resolving the same ask ID." });
  expect((await invoke()).status).toBe(200);
});

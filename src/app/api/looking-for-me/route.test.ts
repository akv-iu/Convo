import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_USER_A, people } from "@/contracts/fixtures";
import { routes } from "@/contracts/routes";
import { store } from "@/contracts/fake/store";

const { identity, runtime, getProfile, whoIsLookingFor } = vi.hoisted(() => ({
  identity: { userId: "u_demo_a" as string | null },
  runtime: { fakeApi: false, fakeSearch: true, fakeAi: true },
  getProfile: vi.fn(), whoIsLookingFor: vi.fn(),
}));
vi.mock("@/server/config", () => ({ config: runtime }));
vi.mock("@/server/auth", () => ({ getUserId: async () => identity.userId }));
vi.mock("@/server/profile/service", () => ({ getProfile }));
vi.mock("@/server/search", () => ({ search: { whoIsLookingFor } }));
vi.mock("next/server", async importOriginal => ({
  ...await importOriginal<typeof import("next/server")>(), connection: async () => undefined,
}));
import { GET } from "./route";

const invoke = () => GET(new Request("http://localhost:3000/api/looking-for-me"), { params: Promise.resolve({}) });
beforeEach(() => {
  identity.userId = DEMO_USER_A;
  store.reset();
  getProfile.mockReset().mockResolvedValue(people[0]);
  whoIsLookingFor.mockReset().mockResolvedValue(["other-a", "other-b"]);
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Unexpected live call")));
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe.each(["fake", "real"] as const)("%s counter HTTP contract", mode => {
  beforeEach(() => { runtime.fakeApi = mode === "fake"; });

  it("returns the count through the shared route", async () => {
    const response = await invoke();
    expect(response.status).toBe(200);
    expect(routes.lookingForMe.response.parse(await response.json())).toEqual({ count: 2 });
    expect(whoIsLookingFor).toHaveBeenCalledExactlyOnceWith(people[0]);
  });

  it("requires sign-in before searching", async () => {
    identity.userId = null;
    expect((await invoke()).status).toBe(401);
    expect(whoIsLookingFor).not.toHaveBeenCalled();
    expect(getProfile).not.toHaveBeenCalled();
  });
});

it("returns a safe 503 for a real search failure", async () => {
  runtime.fakeApi = false;
  whoIsLookingFor.mockRejectedValue(new Error("private-search-token"));
  const response = await invoke();
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("private-search-token");
});

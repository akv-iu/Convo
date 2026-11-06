import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { routes } from "@/contracts/routes";
import fixture from "@/server/profile/fixtures/ror.json";

const { runtime, identity } = vi.hoisted(() => ({
  identity: { userId: "github:101" as string | null },
  runtime: { fakeApi: false, fakeSearch: true, fakeAi: true, batchRejectAfter: 3, slotLockoutMinutes: 60, maxSlots: 3 },
}));
vi.mock("@/server/config", () => ({ config: runtime }));
vi.mock("@/server/auth", () => ({ getUserId: async () => identity.userId }));
vi.mock("next/server", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/server")>(), connection: async () => undefined,
}));
import { GET } from "./route";

const fetchMock = vi.fn<typeof fetch>();
const request = (query?: string) => new Request(`http://localhost:3000/api/ror${query === undefined ? "" : `?q=${encodeURIComponent(query)}`}`);
const context = () => ({ params: Promise.resolve({}) });
beforeEach(() => {
  runtime.fakeApi = false;
  identity.userId = "github:101";
  fetchMock.mockReset().mockResolvedValue(Response.json({ items: [fixture.items[0]] }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe.each(["fake", "real"] as const)("%s workplace HTTP contract", (mode) => {
  beforeEach(() => { runtime.fakeApi = mode === "fake"; });

  it("returns workplace matches in the same schema", async () => {
    const response = await GET(request("Stanford"), context());
    expect(response.status).toBe(200);
    expect(routes.searchRor.response.parse(await response.json())).toEqual([
      { id: "https://ror.org/00f54p054", name: "Stanford University", country: "US" },
    ]);
    if (mode === "fake") expect(fetchMock).not.toHaveBeenCalled();
    else expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([undefined, "", "  "])("returns an empty list for a blank/missing query without external access", async (query) => {
    const response = await GET(request(query), context());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires sign-in before querying a provider", async () => {
    identity.userId = null;
    const response = await GET(request("Stanford"), context());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "sign in first" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns an empty list for an unmatched workplace", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ items: [] }));
    const response = await GET(request("convo-no-such-workplace-7f9"), context());
    expect(response.status).toBe(200);
    expect(routes.searchRor.response.parse(await response.json())).toEqual([]);
  });
});

describe("real workplace errors", () => {
  it("rejects long queries before calling ROR", async () => {
    const response = await GET(request("x".repeat(201)), context());
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: expect.stringMatching(/200 characters/) });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a safe retryable error rather than treating a ROR outage as no matches", async () => {
    fetchMock.mockResolvedValueOnce(new Response("private upstream details", { status: 429 }));
    const response = await GET(request("Stanford"), context());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Workplace search is unavailable. Try again shortly." });
  });

  it("does not expose malformed provider responses", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ errors: ["private upstream details"] }));
    const response = await GET(request("Stanford"), context());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Workplace search is unavailable. Try again shortly." });
  });
});

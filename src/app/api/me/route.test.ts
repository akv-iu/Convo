import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { people, DEMO_USER_A } from "@/contracts/fixtures";
import { routes } from "@/contracts/routes";
import type { Person } from "@/contracts/types";
import { store } from "@/contracts/fake/store";

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
import { GET, PUT } from "./route";
import { GET as getAvailability, PUT as putAvailability } from "../availability/route";

const person = structuredClone(people[0]);
const context = () => ({ params: Promise.resolve({}) });
const request = (path: string, body?: unknown) => new Request(`http://localhost:3000/api/${path}`, {
  method: body === undefined ? "GET" : "PUT",
  ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
});
function result(value: Person = person, filters: Person["filters"] | null = value.filters) {
  return { rows: [[value.id, value.githubLogin, value.name, value.bio,
    JSON.stringify(value.languages), JSON.stringify(value.organisations), filters === null ? null : JSON.stringify(filters),
    JSON.stringify(value.freeTimes), "2026-11-05T00:00:00Z", 1,
    value.workplaceName ?? null, value.badgeColour ?? "sunflower", JSON.stringify(value.visibility ?? { country: true, workplace: true, hiring: true }), "[]", false]] };
}
beforeEach(() => {
  runtime.fakeApi = false;
  identity.userId = DEMO_USER_A;
  store.reset();
  query.mockReset().mockResolvedValue(result());
  vi.stubEnv("DATABASE_URL", "postgresql://unused:unused@example.invalid/unused");
});
afterEach(() => vi.unstubAllEnvs());

describe.each(["fake", "real"] as const)("%s profile/availability HTTP contract", (mode) => {
  beforeEach(() => { runtime.fakeApi = mode === "fake"; });

  it("saves, reads and clears custom workplaces with the same fake/real payload", async () => {
    const updated = { ...person, workplaceName: "Acme Robotics", badgeColour: "lilac" as const,
      visibility: { country: false, workplace: false, hiring: false } };
    query.mockResolvedValueOnce(result()).mockResolvedValueOnce(result(updated));
    const response = await PUT(request("me", { workplaceName: "  Acme Robotics  ", badgeColour: "lilac", visibility: updated.visibility }), context());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(updated);
    if (mode === "real") query.mockResolvedValueOnce(result(updated));
    expect(await (await GET(request("me"), context())).json()).toEqual(updated);
    if (mode === "real") query.mockResolvedValueOnce(result(updated)).mockResolvedValueOnce(result({ ...updated, workplaceName: null }));
    expect(await (await PUT(request("me", { workplaceName: null }), context())).json()).toMatchObject({ workplaceName: null, badgeColour: "lilac" });
  });

  it.each([{ workplaceName: " " }, { workplaceName: "x".repeat(201) }, { badgeColour: "neon" }, { visibility: { country: false } }])("rejects invalid presentation fields %j", async body => {
    expect((await PUT(request("me", body), context())).status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it("returns the same profile response shape", async () => {
    const response = await GET(request("me"), context());
    expect(response.status).toBe(200);
    expect(routes.getMe.response.parse(await response.json())).toEqual(person);
    if (mode === "fake") expect(query).not.toHaveBeenCalled();
  });

  it("saves an edit without accepting caller-supplied identity or synthetic flags", async () => {
    const updated = { ...person, name: "Edited name" };
    query.mockResolvedValueOnce(result()).mockResolvedValueOnce(result(updated));
    const response = await PUT(request("me", { name: updated.name, id: "another-user", synthetic: true,
      githubEvidence: [{ personId: "another-user", title: "Forged repository" }], githubEvidencePending: false }), context());
    expect(response.status).toBe(200);
    expect(routes.putMe.response.parse(await response.json())).toEqual(updated);
    if (mode === "real") expect(query.mock.calls[1][1]).toEqual(["Edited name", DEMO_USER_A]);
  });

  it("reads and replaces availability with the shared response schema", async () => {
    const response = await getAvailability(request("availability"), context());
    expect(response.status).toBe(200);
    expect(routes.getAvailability.response.parse(await response.json())).toEqual(person.freeTimes);
    query.mockResolvedValueOnce(result({ ...person, freeTimes: [] }));
    const cleared = await putAvailability(request("availability", []), context());
    expect(cleared.status).toBe(200);
    expect(routes.putAvailability.response.parse(await cleared.json())).toEqual([]);
  });

  it("rejects invalid profile and availability payloads before storage", async () => {
    expect((await PUT(request("me", { filters: { country: "invalid" } }), context())).status).toBe(400);
    expect((await putAvailability(request("availability", [{ start: "bad", end: "bad" }]), context())).status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it("requires authentication before reading or writing", async () => {
    identity.userId = null;
    expect((await GET(request("me"), context())).status).toBe(401);
    expect((await PUT(request("me", { name: "Someone else" }), context())).status).toBe(401);
    expect((await putAvailability(request("availability", []), context())).status).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });
});

describe("real route failures", () => {
  it("returns an actionable onboarding error instead of an off-contract profile", async () => {
    query.mockResolvedValueOnce(result(person, null));
    const response = await GET(request("me"), context());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: expect.stringMatching(/onboarding/) });
  });

  it("returns a safe error for database failures", async () => {
    query.mockRejectedValueOnce(new Error("secret-db-password"));
    const response = await GET(request("me"), context());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("secret-db-password");
  });

  it("returns 404 when a saved user no longer exists", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    expect((await putAvailability(request("availability", []), context())).status).toBe(404);
  });
});

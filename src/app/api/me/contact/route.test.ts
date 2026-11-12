import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_USER_A } from "@/contracts/fixtures";
import { routes } from "@/contracts/routes";
import { store } from "@/contracts/fake/store";

const { query, runtime, identity } = vi.hoisted(() => ({
  query: vi.fn(), identity: { userId: "u_demo_a" as string | null },
  runtime: { fakeApi: false, fakeSearch: true, fakeAi: true, fakeDemo: false, batchRejectAfter: 3, slotLockoutMinutes: 60, maxSlots: 3 },
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

const context = () => ({ params: Promise.resolve({}) });
const request = (body?: unknown) => new Request("http://localhost:3000/api/me/contact", {
  method: body === undefined ? "GET" : "PUT",
  ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
});
const details = { email: "ana@example.com", phone: "+44 7700 900123", share: "both" as const };

beforeEach(() => {
  identity.userId = DEMO_USER_A;
  store.reset();
  query.mockReset().mockResolvedValue({ rows: [[details.email, details.phone, details.share]] });
  vi.stubEnv("DATABASE_URL", "postgresql://unused:unused@example.invalid/unused");
});
afterEach(() => vi.unstubAllEnvs());

describe.each(["fake", "real"] as const)("%s contact details HTTP contract", (mode) => {
  beforeEach(() => { runtime.fakeApi = mode === "fake"; });

  it("saves and reads back the private contact details", async () => {
    const saved = await PUT(request(details), context());
    expect(saved.status).toBe(200);
    expect(routes.putContact.response.parse(await saved.json())).toEqual(details);
    const read = await GET(request(), context());
    expect(routes.getContact.response.parse(await read.json())).toEqual(details);
  });

  it("rejects a malformed email or phone before saving", async () => {
    expect((await PUT(request({ ...details, email: "not-an-email" }), context())).status).toBe(400);
    expect((await PUT(request({ ...details, phone: "call me" }), context())).status).toBe(400);
    if (mode === "real") expect(query).not.toHaveBeenCalled();
  });

  it("asks for sign-in first", async () => {
    identity.userId = null;
    expect((await GET(request(), context())).status).toBe(401);
  });
});

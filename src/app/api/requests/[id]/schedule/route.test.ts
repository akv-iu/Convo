import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_USER_A, DEMO_USER_B } from "@/contracts/fixtures";
import { routes } from "@/contracts/routes";
import type { Request as SavedRequest } from "@/contracts/types";
import { store } from "@/contracts/fake/store";

const { query, transaction, txQuery, runtime, identity } = vi.hoisted(() => ({
  query: vi.fn(), transaction: vi.fn(), txQuery: vi.fn(), identity: { userId: "u_demo_a" as string | null },
  runtime: { fakeApi: false, fakeSearch: true, fakeAi: true, batchRejectAfter: 3, slotLockoutMinutes: 60, maxSlots: 3 },
}));
vi.mock("@/server/config", () => ({ config: runtime }));
vi.mock("@/server/auth", () => ({ getUserId: async () => identity.userId }));
vi.mock("next/server", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/server")>(), connection: async () => undefined,
}));
vi.mock("@neondatabase/serverless", async (importOriginal) => ({
  ...await importOriginal<typeof import("@neondatabase/serverless")>(), neon: () => ({ query, transaction }),
}));
import { POST as book } from "./route";
import { GET as slots } from "../slots/route";

const saved: SavedRequest = {
  id: "saved-request", askId: "saved-ask", fromUserId: DEMO_USER_A, toPersonId: DEMO_USER_B,
  question: "Question?", minutes: 10, status: "accepted", reply: null, slot: null,
  createdAt: "2026-11-05T12:00:00.000Z",
};
const slot = { start: "2026-11-09T18:00:00.000Z", end: "2026-11-09T18:10:00.000Z" };
const free = [{ start: slot.start, end: "2026-11-09T19:00:00.000Z" }];
const context = (id = saved.id) => ({ params: Promise.resolve({ id }) });
const req = (body?: unknown) => new Request("http://localhost:3000/api/requests/saved-request/schedule", {
  method: body === undefined ? "GET" : "POST",
  ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
});
const read = () => query.mockResolvedValueOnce({ rows: [Object.values(saved)] });
const availability = () => query.mockResolvedValueOnce({ rows: [[DEMO_USER_A, free, 1], [DEMO_USER_B, free, 2]] });
beforeEach(() => {
  runtime.fakeApi = false; identity.userId = DEMO_USER_A;
  store.reset(); store.get().requests.set(saved.id, { ...saved });
  store.person(DEMO_USER_A).freeTimes = structuredClone(free);
  store.person(DEMO_USER_B).freeTimes = structuredClone(free);
  query.mockReset().mockResolvedValue({ rows: [] });
  txQuery.mockReset().mockReturnValue({});
  transaction.mockReset().mockImplementation(async callback => {
    callback({ query: txQuery });
    return [[{ saved: { ...saved, slot, status: "scheduled" } }]];
  });
  vi.stubEnv("DATABASE_URL", "postgresql://unused:unused@example.invalid/unused");
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Unexpected live request")));
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-09T15:00:00.000Z"));
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  if (runtime.fakeApi) { expect(query).not.toHaveBeenCalled(); expect(transaction).not.toHaveBeenCalled(); }
  vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals();
});

describe.each(["fake", "real"] as const)("%s scheduling HTTP contract", mode => {
  beforeEach(() => { runtime.fakeApi = mode === "fake"; if (mode === "real") store.reset(); });

  it.each([DEMO_USER_A, DEMO_USER_B])("lets participant %s find and book a slot", async userId => {
    identity.userId = userId;
    if (mode === "real") { read(); availability(); }
    const listed = await slots(req(), context());
    expect(listed.status).toBe(200);
    expect(routes.slots.response.parse(await listed.json())).toEqual([slot]);
    if (mode === "real") { read(); availability(); }
    const booked = await book(req({ slot, fromUserId: "forged" }), context());
    expect(booked.status).toBe(200);
    expect(routes.schedule.response.parse(await booked.json())).toEqual({ ...saved, slot, status: "scheduled" });
  });

  it("refuses outsiders on both routes", async () => {
    identity.userId = "outsider";
    if (mode === "real") read();
    expect((await slots(req(), context())).status).toBe(403);
    if (mode === "real") read();
    expect((await book(req({ slot, userId: DEMO_USER_A }), context())).status).toBe(403);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("returns404 for missing requests", async () => {
    expect((await slots(req(), context("missing"))).status).toBe(404);
    expect((await book(req({ slot }), context("missing"))).status).toBe(404);
  });

  it("requires sign-in on both routes", async () => {
    identity.userId = null;
    expect((await slots(req(), context())).status).toBe(401);
    expect((await book(req({ slot }), context())).status).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });

  it.each([{}, { slot: {} }, { slot: { start: "tomorrow", end: slot.end } }])("rejects malformed bodies %j", async body => {
    expect((await book(req(body), context())).status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });
});

it("returns a sanitized409 when a real concurrent booking loses serialization", async () => {
  read(); availability();
  transaction.mockRejectedValueOnce(Object.assign(new Error("secret-sql-details"), { code: "40001" }));
  const response = await book(req({ slot }), context());
  expect(response.status).toBe(409);
  expect(await response.text()).not.toContain("secret-sql-details");
});

it("does not allow the real backend to book an unaccepted request", async () => {
  query.mockResolvedValueOnce({ rows: [Object.values({ ...saved, status: "sent" })] });
  expect((await book(req({ slot }), context())).status).toBe(409);
  expect(transaction).not.toHaveBeenCalled();
});

it("returns503 without leaking real storage failures", async () => {
  query.mockRejectedValue(new Error("secret-db-password"));
  for (const response of [await slots(req(), context()), await book(req({ slot }), context())]) {
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("secret-db-password");
  }
});

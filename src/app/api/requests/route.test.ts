import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_USER_A, DEMO_USER_B } from "@/contracts/fixtures";
import { routes, type RouteBody } from "@/contracts/routes";
import { Request as RequestSchema, type Request as SavedRequest } from "@/contracts/types";
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
import { GET as readAsk } from "../asks/[id]/route";
import { GET as inbox } from "../inbox/route";
import { POST as respond } from "./[id]/respond/route";
import { POST as send } from "./route";
import { GET as sent } from "./sent/route";

const saved: SavedRequest = {
  id: "saved-request", askId: "saved-ask", fromUserId: DEMO_USER_A, toPersonId: DEMO_USER_B,
  question: "How does preemption work?", message: null, minutes: 10, status: "sent", reply: null, slot: null,
  createdAt: "2026-11-05T12:00:00.000Z",
};
const context = (id = saved.id) => ({ params: Promise.resolve({ id }) });
const request = (body: unknown) => new Request("http://localhost:3000/api/requests/saved-request/respond", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const get = () => new Request("http://localhost:3000/api/inbox");
/** The request fields of inbox items (the schema drops the rest); badges and ask types are checked separately. */
const plain = (views: unknown[]) => views.map((view) => RequestSchema.parse(view));
beforeEach(() => {
  runtime.fakeApi = false;
  identity.userId = DEMO_USER_B;
  store.reset();
  store.get().requests.set(saved.id, { ...saved });
  query.mockReset().mockResolvedValue({ rows: [] });
  vi.stubEnv("DATABASE_URL", "postgresql://unused:unused@example.invalid/unused");
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Unexpected live request")));
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  if (runtime.fakeApi) expect(query).not.toHaveBeenCalled();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe.each(["fake", "real"] as const)("%s request HTTP contract", (mode) => {
  beforeEach(() => {
    runtime.fakeApi = mode === "fake";
    if (mode === "real") store.reset(); // Persistence must not read the demo request store.
  });

  function seedAsk() {
    identity.userId = DEMO_USER_A;
    if (mode === "real") query.mockResolvedValueOnce({ rows: [[saved.question, null]] });
    else store.get().asks.set(saved.askId, { id: saved.askId, userId: DEMO_USER_A, rawText: saved.question,
      refined: null, status: "open", softBlocker: true, createdAt: saved.createdAt });
  }

  it("sends a request that appears in the recipient inbox, ignoring forged sender and question fields", async () => {
    seedAsk();
    if (mode === "real") query.mockResolvedValueOnce({ rows: [] }) // Real search fixture lookup.
      .mockImplementationOnce(async (_sql, params) => ({ rows: [params] }));
    const response = await send(request({ askId: saved.askId, toPersonId: DEMO_USER_B,
      fromUserId: "forged", question: "forged", minutes: 999 }), context());
    expect(response.status).toBe(200);
    const sent = routes.sendRequest.response.parse(await response.json());
    expect(sent).toMatchObject({ askId: saved.askId, toPersonId: DEMO_USER_B, fromUserId: DEMO_USER_A,
      // The fake returns the request it already holds for this person; the real route saves a new one,
      // and an unrefined ask gets the 5-minute default.
      question: saved.question, minutes: mode === "fake" ? saved.minutes : 5, status: "sent", reply: null, slot: null });
    identity.userId = DEMO_USER_B;
    if (mode === "real") query.mockResolvedValueOnce({ rows: [Object.values(sent)] });
    const received = await inbox(get(), context());
    expect(received.status).toBe(200);
    expect(plain(routes.inbox.response.parse(await received.json()))).toContainEqual(sent);
  });

  it("rejects an unknown recipient", async () => {
    seedAsk();
    expect((await send(request({ askId: saved.askId, toPersonId: "missing-person" }), context())).status).toBe(404);
  });

  it("allows the existing self-send behavior for a single-account inbox test", async () => {
    seedAsk();
    if (mode === "real") query.mockResolvedValueOnce({ rows: [[DEMO_USER_A]] })
      .mockImplementationOnce(async (_sql, params) => ({ rows: [params] }));
    const response = await send(request({ askId: saved.askId, toPersonId: DEMO_USER_A }), context());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ fromUserId: DEMO_USER_A, toPersonId: DEMO_USER_A });
  });

  it.each(["missing-ask", saved.askId])("rejects a missing or foreign ask %s", async (askId) => {
    seedAsk();
    identity.userId = DEMO_USER_B;
    query.mockReset().mockResolvedValue({ rows: [] });
    expect((await send(request({ askId, toPersonId: DEMO_USER_A, userId: DEMO_USER_A }), context())).status).toBe(404);
    if (mode === "real") expect(query.mock.calls[0][1]).toEqual([askId, DEMO_USER_B, 1]);
  });

  it("requires a recipient before touching storage", async () => {
    expect((await send(request({ askId: saved.askId }), context())).status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it("shows the question in the receiver's inbox, with newest requests first", async () => {
    const newest = { ...saved, id: "newest", createdAt: "2026-11-05T12:01:00.000Z" };
    if (mode === "real") query.mockResolvedValueOnce({ rows: [Object.values(newest), Object.values(saved)] });
    else store.get().requests.set(newest.id, newest);
    const response = await inbox(get(), context());
    expect(response.status).toBe(200);
    expect(plain(routes.inbox.response.parse(await response.json()))).toEqual([newest, saved]);
  });

  it("does not show outgoing requests in the sender's inbox", async () => {
    identity.userId = DEMO_USER_A;
    const response = await inbox(get(), context());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
    if (mode === "real") expect(query.mock.calls[0][1]).toEqual([DEMO_USER_A]);
  });

  it("lists the asker's sent requests with each receiver's badge", async () => {
    identity.userId = DEMO_USER_A;
    if (mode === "real") query.mockResolvedValueOnce({ rows: [Object.values(saved)] }); // then no account row: search has B
    const response = await sent(new Request("http://localhost:3000/api/requests/sent"), context());
    expect(response.status).toBe(200);
    const views = routes.sentRequests.response.parse(await response.json());
    expect(plain(views)).toEqual([saved]);
    expect(views[0].person?.id).toBe(DEMO_USER_B);
    expect(views[0].person).not.toHaveProperty("visibility");
    if (mode === "real") {
      expect(query.mock.calls[0][0]).toContain('where "requests"."from_user_id" = $1');
      expect(query.mock.calls[0][1]).toEqual([DEMO_USER_A]);
    }
  });

  it("does not list someone else's sent requests", async () => {
    identity.userId = DEMO_USER_B;
    const response = await sent(new Request("http://localhost:3000/api/requests/sent"), context());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });

  it("reads back the caller's own ask and reports anyone else's as missing", async () => {
    const ask = { id: saved.askId, userId: DEMO_USER_A, rawText: saved.question, refined: null,
      status: "open" as const, softBlocker: false, createdAt: saved.createdAt };
    store.get().asks.set(ask.id, ask);
    identity.userId = DEMO_USER_A;
    if (mode === "real") query.mockResolvedValueOnce({ rows: [[ask.id, ask.userId, ask.rawText, null, ask.status, ask.softBlocker, ask.createdAt]] });
    const own = await readAsk(new Request(`http://localhost:3000/api/asks/${ask.id}`), context(ask.id));
    expect(own.status).toBe(200);
    expect(routes.getAsk.response.parse(await own.json())).toEqual(ask);
    if (mode === "real") expect(query.mock.calls[0][1]).toEqual([ask.id, DEMO_USER_A, 1]);
    identity.userId = DEMO_USER_B;
    expect((await readAsk(new Request(`http://localhost:3000/api/asks/${ask.id}`), context(ask.id))).status).toBe(404);
  });

  it("allows accept, decline and reply with the same state changes as the frozen fake", async () => {
    const actions: RouteBody<"respond">[] = [
      { action: "accept" }, { action: "decline" }, { action: "reply", reply: "Use priority classes." }, { action: "accept" },
    ];
    let expected = { ...saved };
    for (const body of actions) {
      expected = { ...expected, status: body.action === "accept" ? "accepted" : body.action === "decline" ? "declined" : "answered",
        reply: body.action === "reply" ? body.reply : expected.reply };
      if (mode === "real") query.mockResolvedValueOnce({ rows: [Object.values(expected)] });
      const response = await respond(request({ ...body, toPersonId: DEMO_USER_A }), context());
      expect(response.status).toBe(200);
      expect(routes.respond.response.parse(await response.json())).toEqual(expected);
    }
    if (mode === "real") query.mockResolvedValueOnce({ rows: [Object.values(expected)] });
    expect(plain(await (await inbox(get(), context())).json())).toEqual([expected]);
  });

  it.each([DEMO_USER_A, "unrelated-user"])("refuses a response by %s, even with a forged receiver in the body", async (userId) => {
    identity.userId = userId;
    if (mode === "real") query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [[saved.id]] });
    const response = await respond(request({ action: "reply", reply: "forged", userId: DEMO_USER_B, toPersonId: userId }), context());
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain(saved.question);
    if (mode === "fake") expect(store.get().requests.get(saved.id)).toEqual(saved);
    else expect(query.mock.calls[0][1]).toEqual(["answered", "forged", saved.id, userId]);
  });

  it("returns404 for a nonexistent request", async () => {
    expect((await respond(request({ action: "accept" }), context("missing"))).status).toBe(404);
  });

  it.each([{ action: "reply", reply: "" }, { action: "reply" }, { action: "invalid" }])("rejects malformed response %j before storage", async (body) => {
    expect((await respond(request(body), context())).status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it("returns401 for all three routes when signed out", async () => {
    identity.userId = null;
    expect((await inbox(get(), context())).status).toBe(401);
    expect((await respond(request({ action: "accept" }), context())).status).toBe(401);
    expect((await send(request({ askId: saved.askId, toPersonId: DEMO_USER_B }), context())).status).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });
});

it("sanitizes real database failures in all three request routes", async () => {
  query.mockRejectedValue(new Error("private-db-password"));
  for (const response of [await inbox(get(), context()), await respond(request({ action: "accept" }), context()),
    await send(request({ askId: saved.askId, toPersonId: DEMO_USER_B }), context())]) {
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private-db-password");
  }
});

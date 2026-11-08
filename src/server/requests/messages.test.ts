import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { query, getPerson, getPeople } = vi.hoisted(() => ({ query: vi.fn(), getPerson: vi.fn(), getPeople: vi.fn() }));
vi.mock("@/server/search", () => ({ search: { getPerson, getPeople } }));
vi.mock("@neondatabase/serverless", async (importOriginal) => ({
  ...await importOriginal<typeof import("@neondatabase/serverless")>(), neon: () => ({ query }),
}));
import { sendRequest, getInbox, getSentRequests, respondToRequest } from "./messages";
import { people } from "@/contracts/fixtures";

const request = {
  id: "request-id", askId: "ask-id", fromUserId: "sender", toPersonId: "receiver",
  question: "How does preemption work?", message: null, minutes: 10, status: "sent", reply: null, slot: null,
  createdAt: "2026-11-05T12:00:00.000Z",
};
const row = (changes: Partial<typeof request> = {}) => Object.values({ ...request, ...changes });
beforeEach(() => {
  query.mockReset().mockResolvedValue({ rows: [] });
  getPerson.mockReset().mockResolvedValue(undefined);
  getPeople.mockReset().mockResolvedValue([]);
  vi.stubEnv("DATABASE_URL", "postgresql://unused:unused@example.invalid/unused");
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Unexpected live request")));
});

describe("saved outgoing requests", () => {
  const body = { askId: "ask-id", toPersonId: "receiver" };
  const refined = { text: "How does preemption work?", type: "knowledge", minutes: 15 };
  const ownedAsk = () => query.mockResolvedValueOnce({ rows: [["Original question", refined]] });
  const recipient = () => query.mockResolvedValueOnce({ rows: [[body.toPersonId]] });
  const save = () => query.mockImplementationOnce(async (_sql, params) => ({ rows: [params] }));

  it("copies the stored refined question and duration and uses only the authenticated sender", async () => {
    ownedAsk(); recipient(); save();
    const sent = await sendRequest("sender", body);
    expect(sent).toMatchObject({ ...body, fromUserId: "sender", question: refined.text, minutes: 15,
      status: "sent", reply: null, slot: null });
    expect(sent.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(query.mock.calls[0][0]).toContain('where ("asks"."id" = $1 and "asks"."user_id" = $2)');
    expect(query.mock.calls[0][1]).toEqual([body.askId, "sender", 1]);
    expect(query.mock.calls[1][1]).toEqual([body.toPersonId, 1]);
    expect(query.mock.calls[2][0]).toContain('insert into "requests"');
    expect(query.mock.calls[2][1]).toEqual(Object.values(sent));
    expect(getPerson).not.toHaveBeenCalled();
  });

  it("uses raw text and five minutes for an ask without refinement", async () => {
    query.mockResolvedValueOnce({ rows: [["Original question", null]] }); recipient(); save();
    expect(await sendRequest("sender", body)).toMatchObject({ question: "Original question", minutes: 5 });
  });

  it("allows a search-only synthetic recipient without writing a fabricated user row", async () => {
    ownedAsk(); query.mockResolvedValueOnce({ rows: [] }); save();
    getPerson.mockResolvedValueOnce({ ...people[0], id: body.toPersonId, synthetic: true });
    expect(await sendRequest("sender", body)).toMatchObject({ toPersonId: body.toPersonId });
    expect(getPerson).toHaveBeenCalledExactlyOnceWith(body.toPersonId);
    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls.some(([sql]) => String(sql).startsWith('insert into "users"'))).toBe(false);
  });

  it("returns404 for a missing or foreign ask before any recipient lookup or write", async () => {
    await expect(sendRequest("other", body)).rejects.toMatchObject({ status: 404 });
    expect(query).toHaveBeenCalledOnce();
    expect(getPerson).not.toHaveBeenCalled();
  });

  it("returns404 for an unknown recipient without writing", async () => {
    ownedAsk();
    await expect(sendRequest("sender", body)).rejects.toMatchObject({ status: 404 });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("fails closed when search returns another person's profile", async () => {
    ownedAsk();
    getPerson.mockResolvedValueOnce(people[0]);
    await expect(sendRequest("sender", body)).rejects.toMatchObject({ status: 503 });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("does not write malformed stored refinement", async () => {
    query.mockResolvedValueOnce({ rows: [["Original question", { ...refined, minutes: -1 }]] }); recipient();
    await expect(sendRequest("sender", body)).rejects.toMatchObject({ status: 503, message: "Stored ask is invalid. No request was sent." });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it.each(["ask", "recipient", "search", "insert"])("sanitizes %s failures without retrying the insert", async (stage) => {
    const failure = new Error("private-service-secret");
    if (stage !== "ask") ownedAsk();
    if (stage === "search") getPerson.mockRejectedValueOnce(failure);
    else {
      if (stage === "insert") recipient();
      query.mockRejectedValueOnce(failure);
    }
    const error = await sendRequest("sender", body).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 503 });
    expect(String(error)).not.toContain("private-service-secret");
    expect(query.mock.calls.filter(([sql]) => String(sql).startsWith("insert"))).toHaveLength(stage === "insert" ? 1 : 0);
    if (stage === "insert") expect(String(error)).toContain("Retrying is safe");
  });

  it("returns the saved request on a repeated send instead of creating a duplicate", async () => {
    ownedAsk(); recipient(); save();
    const first = await sendRequest("sender", body);
    ownedAsk(); recipient();
    query.mockResolvedValueOnce({ rows: [] }) // unique ask/recipient: nothing inserted
      .mockResolvedValueOnce({ rows: [query.mock.calls[2][1]] }); // the saved row, in column order
    const second = await sendRequest("sender", body);
    expect(second).toEqual(first);
    expect(query.mock.calls[2][0]).toContain('on conflict ("ask_id","to_person_id") do nothing');
    expect(query.mock.calls[6][0]).toContain('where ("requests"."ask_id" = $1 and "requests"."to_person_id" = $2)');
    expect(query.mock.calls[6][1]).toEqual([body.askId, body.toPersonId, 1]);
  });

  it("reports an unconfirmed save when neither a new nor a saved request comes back", async () => {
    ownedAsk(); recipient();
    const error = await sendRequest("sender", body).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 503 });
    expect(String(error)).toContain("Retrying is safe");
  });
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("saved inbox", () => {
  it("reads only the receiver's requests in descending time order with a stable tie-breaker", async () => {
    query.mockResolvedValueOnce({ rows: [row()] });
    expect(await getInbox("receiver")).toEqual([{ ...request, type: null, person: null }]);
    expect(query).toHaveBeenCalledTimes(3); // requests, then accounts and ask types together
    const [statement, params] = query.mock.calls[0];
    expect(statement).toContain('where "requests"."to_person_id" = $1');
    expect(statement).toContain('order by "requests"."created_at" desc, "requests"."id" desc');
    expect(params).toEqual(["receiver"]);
  });

  it("returns an empty inbox", async () => {
    expect(await getInbox("receiver")).toEqual([]);
  });

  it("does not expose malformed stored data", async () => {
    query.mockResolvedValueOnce({ rows: [row({ minutes: -1 })] });
    await expect(getInbox("receiver")).rejects.toMatchObject({ status: 503 });
  });

  it("sanitizes database errors", async () => {
    query.mockRejectedValueOnce(new Error("private-db-password"));
    await expect(getInbox("receiver")).rejects.toMatchObject({ status: 503, message: "Inbox storage is unavailable. Try again." });
  });
});

describe("badges on requests", () => {
  const asker = people[0];
  // A users row in column order, as the Neon driver returns it.
  const account = (p: (typeof people)[number], visibility = { country: true, workplace: true, hiring: true }) => [
    p.id, p.githubLogin, p.name, p.bio, JSON.stringify(p.languages), JSON.stringify(p.organisations), JSON.stringify(p.filters),
    JSON.stringify(p.freeTimes), "2026-11-05T12:00:00Z", 1, p.workplaceName ?? null, p.badgeColour ?? "sunflower",
    JSON.stringify(visibility), "[]", false,
  ];

  it("shows the asker's badge from their account, with their show/hide choices, and the ask's type", async () => {
    query.mockResolvedValueOnce({ rows: [row({ fromUserId: asker.id })] })
      .mockResolvedValueOnce({ rows: [account(asker, { country: false, workplace: true, hiring: false })] })
      .mockResolvedValueOnce({ rows: [[request.askId, JSON.stringify({ text: "Q", type: "career", minutes: 10 })]] });
    const [view] = await getInbox("receiver");
    expect(view).toMatchObject({ ...request, fromUserId: asker.id, type: "career" });
    expect(view.person).toMatchObject({ id: asker.id, name: asker.name, filters: { country: null, hiring: null } });
    expect(view.person).not.toHaveProperty("visibility");
    expect(query.mock.calls[1][0]).toContain('from "users" where "users"."id" in ($1)');
    expect(query.mock.calls[1][1]).toEqual([asker.id]);
    expect(query.mock.calls[2][1]).toEqual([request.askId]);
    expect(getPeople).toHaveBeenCalledExactlyOnceWith([]); // everyone had an account
  });

  it("reads people without an account in one search call, and fails closed for a real account found only in search", async () => {
    const synthetic = { ...people[1], synthetic: true, visibility: { country: false, workplace: true, hiring: true } };
    const searchOnly = { ...people[2], synthetic: false };
    query.mockResolvedValueOnce({ rows: [
      row({ id: "r1", toPersonId: synthetic.id }), row({ id: "r2", toPersonId: searchOnly.id }), row({ id: "r3", toPersonId: "gone" }),
    ] });
    getPeople.mockResolvedValueOnce([synthetic, searchOnly]);
    const views = await getSentRequests("sender");
    expect(query.mock.calls[0][0]).toContain('where "requests"."from_user_id" = $1');
    expect(getPeople).toHaveBeenCalledExactlyOnceWith([synthetic.id, searchOnly.id, "gone"]);
    expect(views.map((v) => v.person?.id ?? null)).toEqual([synthetic.id, searchOnly.id, null]);
    expect(views[0].person?.filters).toEqual({ ...synthetic.filters, country: null });
    expect(views[1].person).toMatchObject({ workplaceName: null, filters: { country: null, rorId: null, hiring: null } });
  });

  it("gives no badge for an unfinished saved profile instead of guessing one", async () => {
    const unfinished = account(asker);
    unfinished[6] = null; // no onboarding answers yet
    query.mockResolvedValueOnce({ rows: [row({ fromUserId: asker.id })] }).mockResolvedValueOnce({ rows: [unfinished] });
    const [view] = await getInbox("receiver");
    expect(view.person).toBeNull();
    expect(getPeople).toHaveBeenCalledExactlyOnceWith([]); // they have an account, so search isn't asked
  });

  it.each([
    { read: getInbox, user: "receiver", message: "Inbox storage is unavailable. Try again." },
    { read: getSentRequests, user: "sender", message: "Sent requests are unavailable. Try again." },
  ])("reports a corrupt profile in $user's list as unavailable", async ({ read, user, message }) => {
    const corrupt = account(asker);
    corrupt[6] = JSON.stringify({ country: "private-invalid-country", rorId: null, hiring: true });
    query.mockResolvedValueOnce({ rows: [row(user === "receiver" ? { fromUserId: asker.id } : { toPersonId: asker.id })] })
      .mockResolvedValueOnce({ rows: [corrupt] });

    const error = await read(user).catch((error: unknown) => error);
    expect(error).toMatchObject({ status: 503, message });
    expect(String(error)).not.toContain("private-invalid-country");
    expect(getPeople).not.toHaveBeenCalled();
  });

  it("reports a failed badge lookup as unavailable, without provider details", async () => {
    query.mockResolvedValueOnce({ rows: [row()] });
    getPeople.mockRejectedValueOnce(new Error("private-search-token"));
    const error = await getSentRequests("sender").catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 503, message: "Sent requests are unavailable. Try again." });
    expect(String(error)).not.toContain("private-search-token");
  });
});

describe("saved responses", () => {
  it.each([
    { action: "accept" as const, status: "accepted" },
    { action: "decline" as const, status: "declined" },
    { action: "reply" as const, reply: "Use priority classes.", status: "answered" },
  ])("saves $action with receiver authorization inside the update", async ({ status, ...body }) => {
    const result = { ...request, status, reply: body.action === "reply" ? body.reply : null };
    query.mockResolvedValueOnce({ rows: [Object.values(result)] });
    expect(await respondToRequest("receiver", request.id, body)).toEqual(result);
    expect(query).toHaveBeenCalledOnce();
    const [statement, params] = query.mock.calls[0];
    expect(statement).toContain('update "requests" set "status" = $1');
    expect(statement).toMatch(/where \("requests"\."id" = \$\d and "requests"\."to_person_id" = \$\d\)/);
    expect(params).toEqual(body.action === "reply" ? [status, body.reply, request.id, "receiver"] : [status, request.id, "receiver"]);
    expect(statement.split(" where ")[0]).not.toContain('"slot"');
    expect(statement.split(" where ")[0]).not.toContain('"question"');
  });

  it("returns403 to the sender without reading or returning the receiver's private message", async () => {
    query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [[request.id]] });
    await expect(respondToRequest("sender", request.id, { action: "accept" })).rejects.toMatchObject({ status: 403 });
    expect(query.mock.calls[0][1]).toEqual(["accepted", request.id, "sender"]);
    expect(query.mock.calls[1][0]).toMatch(/^select "id" from "requests"/);
  });

  it("returns404 for an unknown request", async () => {
    await expect(respondToRequest("receiver", "missing", { action: "decline" })).rejects.toMatchObject({ status: 404 });
  });

  it("does not retry an unconfirmed write or leak its error", async () => {
    query.mockRejectedValueOnce(new Error("private-db-password"));
    const error = await respondToRequest("receiver", request.id, { action: "accept" }).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 503 });
    expect(String(error)).toContain("could not be confirmed");
    expect(String(error)).not.toContain("private-db-password");
    expect(query).toHaveBeenCalledOnce();
  });

  it("preserves an existing reply and slot when the receiver changes their response", async () => {
    const result = { ...request, status: "accepted", reply: "Earlier answer",
      slot: { start: "2026-11-09T12:00:00.000Z", end: "2026-11-09T12:10:00.000Z" } };
    query.mockResolvedValueOnce({ rows: [Object.values(result)] });
    expect(await respondToRequest("receiver", request.id, { action: "accept" })).toEqual(result);
    expect(query.mock.calls[0][0].split(" where ")[0]).toBe('update "requests" set "status" = $1');
  });

  it("reports an unconfirmed save if the returned stored request fails validation", async () => {
    query.mockResolvedValueOnce({ rows: [row({ minutes: 0, status: "accepted" })] });
    const error = await respondToRequest("receiver", request.id, { action: "accept" }).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 503 });
    expect(String(error)).toContain("refresh your inbox");
    expect(query).toHaveBeenCalledOnce();
  });

  it("sanitizes the existence lookup failure after no row was updated", async () => {
    query.mockResolvedValueOnce({ rows: [] }).mockRejectedValueOnce(new Error("private-db-password"));
    const error = await respondToRequest("receiver", request.id, { action: "accept" }).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 503 });
    expect(String(error)).not.toContain("private-db-password");
  });
});

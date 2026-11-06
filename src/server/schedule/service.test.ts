import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, TimeBlock } from "@/contracts/types";

const { query, transaction, txQuery, getAvailability } = vi.hoisted(() => ({
  query: vi.fn(), transaction: vi.fn(), txQuery: vi.fn(), getAvailability: vi.fn(),
}));
vi.mock("@neondatabase/serverless", async (importOriginal) => ({
  ...await importOriginal<typeof import("@neondatabase/serverless")>(), neon: () => ({ query, transaction }),
}));
vi.mock("@/server/search", () => ({ search: { getAvailability } }));
import { bookSlot, getSlots } from "./service";

const request: Request = {
  id: "request-id", askId: "ask-id", fromUserId: "sender", toPersonId: "receiver", question: "Question?",
  minutes: 10, status: "accepted", reply: null, slot: null, createdAt: "2026-11-05T12:00:00.000Z",
};
const slot = { start: "2026-11-09T18:00:00.000Z", end: "2026-11-09T18:10:00.000Z" };
const free = [{ start: slot.start, end: "2026-11-09T20:00:00.000Z" }];
const saved = { ...request, status: "scheduled", slot };
const read = (changes: Partial<Request> = {}) => query.mockResolvedValueOnce({ rows: [Object.values({ ...request, ...changes })] });
const availability = (a: TimeBlock[] = free, b: TimeBlock[] = free) => query.mockResolvedValueOnce({
  rows: [["sender", a, 4], ["receiver", b, 9]],
});

beforeEach(() => {
  query.mockReset().mockResolvedValue({ rows: [] });
  txQuery.mockReset().mockReturnValue({});
  transaction.mockReset().mockImplementation(async callback => {
    callback({ query: txQuery });
    return [[{ saved }]];
  });
  getAvailability.mockReset().mockResolvedValue({});
  vi.stubEnv("DATABASE_URL", "postgresql://unused:unused@example.invalid/unused");
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Unexpected live request")));
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-09T15:00:00.000Z"));
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals();
});

describe("available meeting slots", () => {
  it("keeps a near-cutoff suggestion bookable after the user takes a few seconds to click", async () => {
    vi.setSystemTime(new Date("2026-11-09T17:30:00.000Z"));
    read(); availability();
    const [suggested] = await getSlots("sender", request.id);
    expect(suggested).toEqual({ start: "2026-11-09T18:31:00.000Z", end: "2026-11-09T18:41:00.000Z" });
    vi.setSystemTime(new Date("2026-11-09T17:30:03.000Z"));
    read(); availability();
    transaction.mockResolvedValueOnce([[{ saved: { ...saved, slot: suggested } }]]);
    expect(await bookSlot("sender", request.id, suggested)).toMatchObject({ status: "scheduled", slot: suggested });
  });

  it.each(["sender", "receiver"])("lets %s see shared availability excluding either person's saved bookings", async userId => {
    read(); availability();
    query.mockResolvedValueOnce({ rows: [[{ start: slot.start, end: "2026-11-09T18:30:00.000Z" }]] });
    expect(await getSlots(userId, request.id)).toEqual([
      { start: "2026-11-09T18:30:00.000Z", end: "2026-11-09T18:40:00.000Z" },
    ]);
    const [statement, params] = query.mock.calls[2];
    expect(statement).toContain('"requests"."slot" is not null');
    expect(statement).toContain('"requests"."from_user_id" in');
    expect(statement).toContain('"requests"."to_person_id" in');
    expect(params).toEqual(["sender", "receiver", "sender", "receiver"]);
    expect(statement).not.toContain('"status"');
    expect(getAvailability).not.toHaveBeenCalled();
  });

  it("looks up search-only participants in one batch and prefers database availability", async () => {
    read(); query.mockResolvedValueOnce({ rows: [["sender", free, 2]] });
    getAvailability.mockResolvedValueOnce({ receiver: free, sender: [] });
    expect(await getSlots("sender", request.id)).toEqual([slot]);
    expect(getAvailability).toHaveBeenCalledExactlyOnceWith(["receiver"]);
  });

  it("returns no suggestions for empty or disjoint availability", async () => {
    read(); availability([], free);
    expect(await getSlots("sender", request.id)).toEqual([]);
  });

  it("does not query search twice when both participant IDs are the same", async () => {
    read({ toPersonId: "sender" });
    query.mockResolvedValueOnce({ rows: [["sender", free, 4]] });
    expect(await getSlots("sender", request.id)).toEqual([slot]);
    expect(query.mock.calls[1][1]).toEqual(["sender"]);
    expect(getAvailability).not.toHaveBeenCalled();
  });

  it.each(["sent", "declined", "answered"] as const)("returns no suggestions while %s", async status => {
    read({ status });
    expect(await getSlots("sender", request.id)).toEqual([]);
    expect(query).toHaveBeenCalledOnce();
  });

  it("returns no suggestions for an already booked request", async () => {
    read({ status: "scheduled", slot });
    expect(await getSlots("sender", request.id)).toEqual([]);
  });

  it.each(["availability", "booked"])("fails closed on invalid stored %s", async stage => {
    read();
    const invalid = [{ start: slot.end, end: slot.start }];
    if (stage === "availability") availability(invalid);
    else { availability(); query.mockResolvedValueOnce({ rows: [[invalid[0]]] }); }
    await expect(getSlots("sender", request.id)).rejects.toMatchObject({ status: 503 });
  });

  it("sanitizes search failures", async () => {
    read(); getAvailability.mockRejectedValueOnce(new Error("private-search-key"));
    const error = await getSlots("sender", request.id).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 503 });
    expect(String(error)).not.toContain("private-search-key");
  });
});

describe("atomic booking", () => {
  it.each(["sender", "receiver"])("lets %s book through a serializable update with current authorization and overlap checks", async userId => {
    read(); availability();
    expect(await bookSlot(userId, request.id, slot)).toEqual(saved);
    expect(transaction).toHaveBeenCalledExactlyOnceWith(expect.any(Function), {
      isolationLevel: "Serializable", arrayMode: false, fullResults: false,
    });
    const [statement, params] = txQuery.mock.calls[0];
    expect(statement).toContain('update "requests" set "status" = $1, "slot" = $2');
    expect(statement).toContain('"requests"."slot" is null');
    expect(statement).toContain('statement_timestamp()');
    expect(statement).toContain('"users"."revision"');
    expect(statement).toContain('not exists (select "id" from "requests" "other_booking"');
    expect(statement).toContain('"other_booking"."from_user_id" in');
    expect(statement).toContain('"other_booking"."to_person_id" in');
    expect(statement).toContain("->>'start')::timestamptz <");
    expect(statement).toContain("->>'end')::timestamptz >");
    expect(params.slice(0, 10)).toEqual(["scheduled", JSON.stringify(slot), request.id,
      userId, userId, "sender", "receiver", "accepted", 10, slot.start]);
    expect(params).toEqual(expect.arrayContaining([4, 9]));
    expect(getAvailability).not.toHaveBeenCalled();
  });

  it("guards against a search-only participant becoming a database user during validation", async () => {
    read(); query.mockResolvedValueOnce({ rows: [["sender", free, 4]] });
    getAvailability.mockResolvedValueOnce({ receiver: free });
    await bookSlot("sender", request.id, slot);
    expect(txQuery.mock.calls[0][0]).toContain('not exists (select "id" from "users"');
  });

  it("treats an identical committed booking as a safe retry even inside the lockout", async () => {
    vi.setSystemTime(new Date(slot.start));
    read({ status: "scheduled", slot });
    expect(await bookSlot("sender", request.id, { start: "2026-11-09T11:00:00-07:00", end: "2026-11-09T11:10:00-07:00" })).toEqual(saved);
    expect(transaction).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledOnce();
  });

  it.each(["sent", "declined", "answered"] as const)("refuses to book a %s request", async status => {
    read({ status });
    await expect(bookSlot("sender", request.id, slot)).rejects.toMatchObject({ status: 409 });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("refuses to silently move an existing booking", async () => {
    read({ status: "scheduled", slot });
    await expect(bookSlot("sender", request.id, { start: slot.end, end: "2026-11-09T18:20:00.000Z" })).rejects.toMatchObject({ status: 409 });
  });

  it.each([
    { start: slot.start, end: slot.start },
    { start: slot.end, end: slot.start },
    { start: slot.start, end: "2026-11-09T18:20:00.000Z" },
  ])("refuses the wrong duration %j", async proposed => {
    read();
    await expect(bookSlot("sender", request.id, proposed)).rejects.toMatchObject({ status: 400 });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("rejects a stale suggestion now inside the one-hour lockout", async () => {
    vi.setSystemTime(new Date("2026-11-09T17:00:00.001Z"));
    read();
    await expect(bookSlot("sender", request.id, slot)).rejects.toMatchObject({ status: 409 });
  });

  it("rejects a valid duration outside either person's availability", async () => {
    read(); availability(free, []);
    await expect(bookSlot("sender", request.id, slot)).rejects.toMatchObject({ status: 409 });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("returns409 if the atomic guard finds a conflict, stale revision or changed request state", async () => {
    read(); availability(); transaction.mockResolvedValueOnce([[]]);
    await expect(bookSlot("sender", request.id, slot)).rejects.toMatchObject({ status: 409 });
  });

  it("turns a serialization conflict into409 without automatic retries", async () => {
    read(); availability(); transaction.mockRejectedValueOnce(Object.assign(new Error("private SQL"), { code: "40001" }));
    const error = await bookSlot("sender", request.id, slot).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 409 });
    expect(String(error)).not.toContain("private SQL");
    expect(transaction).toHaveBeenCalledOnce();
  });

  it("does not retry or leak an uncertain commit", async () => {
    read(); availability(); transaction.mockRejectedValueOnce(new Error("private-db-password"));
    const error = await bookSlot("sender", request.id, slot).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 503 });
    expect(String(error)).toContain("could not be confirmed");
    expect(String(error)).not.toContain("private-db-password");
    expect(transaction).toHaveBeenCalledOnce();
  });

  it("reports a committed booking even if its returned data is invalid", async () => {
    read(); availability(); transaction.mockResolvedValueOnce([[{ saved: { ...saved, minutes: 0 } }]]);
    const error = await bookSlot("sender", request.id, slot).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 503 });
    expect(String(error)).toContain("Booking saved");
  });
});

describe.each([getSlots, (userId: string, id: string) => bookSlot(userId, id, slot)])("scheduling authorization", invoke => {
  it("returns404 for a missing request", async () => {
    await expect(invoke("sender", "missing")).rejects.toMatchObject({ status: 404 });
    expect(query).toHaveBeenCalledOnce();
  });
  it("rejects outsiders before reading availability", async () => {
    read();
    await expect(invoke("outsider", request.id)).rejects.toMatchObject({ status: 403 });
    expect(query).toHaveBeenCalledOnce();
    expect(transaction).not.toHaveBeenCalled();
  });
  it("sanitizes request-read errors", async () => {
    query.mockRejectedValueOnce(new Error("private-db-password"));
    const error = await invoke("sender", request.id).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 503 });
    expect(String(error)).not.toContain("private-db-password");
  });
});

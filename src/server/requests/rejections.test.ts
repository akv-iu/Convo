import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@neondatabase/serverless", async (importOriginal) => ({
  ...await importOriginal<typeof import("@neondatabase/serverless")>(), neon: () => ({ query }),
}));
import { getExclusions, rejectPerson, setSoftBlocker } from "./rejections";

const body = { askId: "owned-ask", personId: "candidate", rank: 2 };
beforeEach(() => {
  query.mockReset().mockResolvedValue({ rows: [] });
  vi.stubEnv("DATABASE_URL", "postgresql://unused:unused@example.invalid/unused");
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Unexpected live request")));
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("saved rejections", () => {
  it("checks ownership inside the parameterized insert and reads only this ask's exclusions", async () => {
    query.mockResolvedValueOnce({ rows: [["rejection-id"]] }).mockResolvedValueOnce({ rows: [[body.personId, body.rank]] });
    expect(await rejectPerson("owner", body)).toEqual({ rejections: 1, hiddenBelowRank: null });
    const [statement, params] = query.mock.calls[0];
    expect(statement).toContain('insert into "rejections"');
    expect(statement).toContain('from "asks" where ("asks"."id" = $4 and "asks"."user_id" = $5)');
    expect(statement).toContain('returning "id"');
    expect(params).toEqual([expect.any(String), body.personId, body.rank, body.askId, "owner"]);
    expect(params[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(query.mock.calls[1][0]).toContain('from "rejections" where "rejections"."ask_id" = $1');
    expect(query.mock.calls[1][1]).toEqual([body.askId]);
  });

  it("returns404 without reading exclusions when no owned ask was inserted from", async () => {
    await expect(rejectPerson("other-user", body)).rejects.toMatchObject({ status: 404 });
    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0][1].at(-1)).toBe("other-user");
  });

  it("appends each submission with a fresh ID, matching the frozen fake's duplicate behavior", async () => {
    query.mockResolvedValueOnce({ rows: [["first-id"]] }).mockResolvedValueOnce({ rows: [[body.personId, 2]] })
      .mockResolvedValueOnce({ rows: [["second-id"]] }).mockResolvedValueOnce({ rows: [[body.personId, 2], [body.personId, 2]] });
    expect(await rejectPerson("owner", body)).toEqual({ rejections: 1, hiddenBelowRank: null });
    expect(await rejectPerson("owner", body)).toEqual({ rejections: 2, hiddenBelowRank: null });
    expect(query.mock.calls[0][1][0]).not.toBe(query.mock.calls[2][1][0]);
    expect(query.mock.calls.filter(([statement]) => String(statement).startsWith("insert"))).toHaveLength(2);
  });

  it("sanitizes write failures and does not retry a possibly committed rejection", async () => {
    query.mockRejectedValueOnce(new Error("private-db-password"));
    const error = await rejectPerson("owner", body).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 503 });
    expect(String(error)).toContain("could not be confirmed");
    expect(String(error)).not.toContain("private-db-password");
    expect(query).toHaveBeenCalledOnce();
  });

  it("reports the successful save if the following count read fails", async () => {
    query.mockResolvedValueOnce({ rows: [["saved-id"]] }).mockRejectedValueOnce(new Error("private-db-password"));
    const error = await rejectPerson("owner", body).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 503 });
    expect(String(error)).toContain("Rejection saved");
    expect(String(error)).toContain("do not resubmit");
    expect(String(error)).not.toContain("private-db-password");
    expect(query).toHaveBeenCalledTimes(2);
  });
});

describe("shared exclusion rule", () => {
  it.each([
    { ranks: [], cutoff: null },
    { ranks: [9, 2], cutoff: null },
    { ranks: [9, 0, 2], cutoff: 9 },
    { ranks: [0, 0, 0], cutoff: 0 },
    { ranks: [9, 2, 3, 4], cutoff: 9 },
  ])("computes the count and maximum rank for $ranks", async ({ ranks, cutoff }) => {
    query.mockResolvedValueOnce({ rows: ranks.map((rank, i) => [`person-${i}`, rank]) });
    expect(await getExclusions(body.askId)).toEqual({
      excludeIds: ranks.map((_, i) => `person-${i}`), rejections: ranks.length, hiddenBelowRank: cutoff,
    });
  });

  it("fails closed on invalid stored ranks", async () => {
    query.mockResolvedValueOnce({ rows: [["candidate", -1]] });
    await expect(getExclusions(body.askId)).rejects.toMatchObject({ status: 503 });
  });
});

describe("saved soft blocker", () => {
  it.each([true, false])("updates only the owned ask's flag to %s without clearing rejections", async (enabled) => {
    query.mockResolvedValueOnce({ rows: [[body.askId, enabled]] });
    expect(await setSoftBlocker("owner", { askId: body.askId, enabled })).toEqual({ askId: body.askId, enabled });
    expect(query).toHaveBeenCalledOnce();
    const [statement, params] = query.mock.calls[0];
    expect(statement).toContain('update "asks" set "soft_blocker" = $1');
    expect(statement).toContain('where ("asks"."id" = $2 and "asks"."user_id" = $3)');
    expect(params).toEqual([enabled, body.askId, "owner"]);
  });

  it("returns404 for a missing or foreign-owned ask", async () => {
    await expect(setSoftBlocker("other-user", { askId: body.askId, enabled: false })).rejects.toMatchObject({ status: 404 });
    expect(query).toHaveBeenCalledOnce();
  });

  it("sanitizes write failures", async () => {
    query.mockRejectedValueOnce(new Error("private-db-password"));
    const error = await setSoftBlocker("owner", { askId: body.askId, enabled: false }).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 503 });
    expect(String(error)).not.toContain("private-db-password");
    expect(query).toHaveBeenCalledOnce();
  });
});

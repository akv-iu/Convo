import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { people } from "@/contracts/fixtures";

const { query, removeAsk, getProfile, whoIsLookingFor } = vi.hoisted(() => ({ query: vi.fn(), removeAsk: vi.fn(), getProfile: vi.fn(), whoIsLookingFor: vi.fn() }));
vi.mock("@neondatabase/serverless", async importOriginal => ({
  ...await importOriginal<typeof import("@neondatabase/serverless")>(), neon: () => ({ query }),
}));
vi.mock("@/server/profile/service", () => ({ getProfile }));
vi.mock("@/server/search", () => ({ search: { whoIsLookingFor, removeAsk } }));
import { lookingForMe, resolveAsk } from "./lifecycle";

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "postgresql://unused:unused@example.invalid/unused");
  query.mockReset().mockResolvedValue({ rows: [] });
  removeAsk.mockReset().mockResolvedValue(undefined);
  getProfile.mockReset().mockResolvedValue(people[0]);
  whoIsLookingFor.mockReset().mockResolvedValue([]);
});
afterEach(() => vi.unstubAllEnvs());

describe("resolve an ask", () => {
  const row = ["ask-one", people[0].id, "Question", null, "resolved", true, "2026-11-05T12:00:00.000Z"];
  it("persists resolution under the authenticated owner and allows retries", async () => {
    query.mockResolvedValue({ rows: [row] });
    const first = await resolveAsk(people[0].id, "ask-one");
    expect(first).toMatchObject({ id: "ask-one", status: "resolved" });
    expect(await resolveAsk(people[0].id, "ask-one")).toEqual(first);
    expect(query.mock.calls[0][0]).toContain('where ("asks"."id" = $2 and "asks"."user_id" = $3)');
    expect(query.mock.calls[0][1]).toEqual(["resolved", "ask-one", people[0].id]);
    expect(removeAsk).toHaveBeenCalledTimes(2);
    expect(removeAsk).toHaveBeenCalledWith("ask-one");
  });
  it("hides missing and foreign asks without removing search entries", async () => {
    await expect(resolveAsk("different-owner", "ask-one")).rejects.toMatchObject({ status: 404 });
    expect(removeAsk).not.toHaveBeenCalled();
  });
  it("does not remove search entries if the database save fails", async () => {
    query.mockRejectedValue(new Error("private-database-token"));
    const error = await resolveAsk(people[0].id, "ask-one").catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 503 });
    expect(String(error)).not.toContain("private-database-token");
    expect(removeAsk).not.toHaveBeenCalled();
  });
  it("repairs search on an identical retry after the database already saved", async () => {
    query.mockResolvedValue({ rows: [row] });
    removeAsk.mockRejectedValueOnce(new Error("private-search-token"));
    const error = await resolveAsk(people[0].id, "ask-one").catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 503 });
    expect(String(error)).toContain("Ask resolved");
    expect(String(error)).not.toContain("private-search-token");
    expect(await resolveAsk(people[0].id, "ask-one")).toMatchObject({ status: "resolved" });
  });
});

describe("people looking for me", () => {
  it("counts distinct other users, not the number of asks", async () => {
    whoIsLookingFor.mockResolvedValue([people[0].id, "other-a", "other-a", "other-b"]);
    expect(await lookingForMe(people[0].id)).toEqual({ count: 2 });
    expect(getProfile).toHaveBeenCalledExactlyOnceWith(people[0].id);
    expect(whoIsLookingFor).toHaveBeenCalledExactlyOnceWith(people[0]);
  });

  it("returns zero when nobody is looking", async () => {
    expect(await lookingForMe(people[0].id)).toEqual({ count: 0 });
  });

  it("requires a complete saved profile before querying search", async () => {
    getProfile.mockRejectedValue(Object.assign(new Error("Complete onboarding first"), { status: 409 }));
    await expect(lookingForMe(people[0].id)).rejects.toMatchObject({ status: 409 });
    expect(whoIsLookingFor).not.toHaveBeenCalled();
  });

  it.each([null, [""], [123]])("rejects malformed search replies %j", async reply => {
    whoIsLookingFor.mockResolvedValue(reply);
    await expect(lookingForMe(people[0].id)).rejects.toMatchObject({ status: 503 });
  });

  it("does not leak dependency errors", async () => {
    whoIsLookingFor.mockRejectedValue(new Error("private-search-token"));
    const error = await lookingForMe(people[0].id).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 503 });
    expect(String(error)).not.toContain("private-search-token");
  });
});

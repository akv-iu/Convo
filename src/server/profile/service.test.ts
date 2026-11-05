import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { people } from "@/contracts/fixtures";
import { routes } from "@/contracts/routes";
import type { Person } from "@/contracts/types";

const { query, ingestPerson } = vi.hoisted(() => ({ query: vi.fn(), ingestPerson: vi.fn() }));
vi.mock("@neondatabase/serverless", async (importOriginal) => ({
  ...await importOriginal<typeof import("@neondatabase/serverless")>(), neon: () => ({ query }),
}));
vi.mock("@/server/search", () => ({ search: { ingestPerson } }));
import { getProfile, updateProfile, getAvailability, saveAvailability } from "./service";

const person = structuredClone(people[0]);
function result(value: Person = person, filters: Person["filters"] | null = value.filters, revision = 1) {
  return { rows: [[value.id, value.githubLogin, value.name, value.bio,
    JSON.stringify(value.languages), JSON.stringify(value.organisations),
    filters === null ? null : JSON.stringify(filters), JSON.stringify(value.freeTimes), "2026-11-05T00:00:00Z", revision]] };
}
beforeEach(() => {
  query.mockReset().mockResolvedValue(result());
  ingestPerson.mockReset().mockResolvedValue(undefined);
  vi.stubEnv("DATABASE_URL", "postgresql://unused:unused@example.invalid/unused");
});
afterEach(() => vi.unstubAllEnvs());

describe("real profile and availability services", () => {
  it("reads only the signed-in user's profile and conforms to the shared response", async () => {
    const actual = await getProfile(person.id);
    expect(actual).toEqual(person);
    expect(routes.getMe.response.parse(actual)).toEqual(actual);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('where "users"."id" =');
    expect(params).toContain(person.id);
    expect(actual).not.toHaveProperty("createdAt");
    expect(actual).not.toHaveProperty("revision");
  });

  it("reports missing profiles without returning another user's data", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(getProfile("missing-user")).rejects.toMatchObject({ status: 404 });
  });

  it("requires onboarding before returning a complete Person", async () => {
    query.mockResolvedValueOnce(result(person, null));
    await expect(getProfile(person.id)).rejects.toMatchObject({ status: 409 });
  });

  it("saves initial onboarding answers before syncing a complete profile", async () => {
    query.mockResolvedValueOnce(result(person, null)).mockResolvedValueOnce(result());
    expect(await updateProfile(person.id, { filters: person.filters })).toEqual(person);
    expect(ingestPerson).toHaveBeenCalledWith(person, undefined, 1);
    expect(query.mock.calls[1][0]).toContain('set "filters" =');
  });

  it("does not partially save a profile edit when onboarding answers are missing", async () => {
    query.mockResolvedValueOnce(result(person, null));
    await expect(updateProfile(person.id, { name: "Changed" })).rejects.toMatchObject({ status: 409 });
    expect(query).toHaveBeenCalledTimes(1);
    expect(ingestPerson).not.toHaveBeenCalled();
  });

  it("patches only supplied fields, preserving unrelated concurrent edits", async () => {
    const updated = { ...person, name: "New name" };
    query.mockResolvedValueOnce(result()).mockResolvedValueOnce(result(updated));
    expect(await updateProfile(person.id, { name: "New name" })).toEqual(updated);
    const [sql, params] = query.mock.calls[1];
    expect(sql).toMatch(/set "name" = \$\d+, "revision" = "users"\."revision" \+ 1 where "users"\."id" = \$\d+ returning/);
    expect(params).toEqual(["New name", person.id]);
    expect(ingestPerson).toHaveBeenCalledWith(updated, undefined, 1);
  });

  it("handles an empty patch without issuing an invalid empty UPDATE", async () => {
    expect(await updateProfile(person.id, {})).toEqual(person);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("reads availability even before onboarding is complete", async () => {
    query.mockResolvedValueOnce(result(person, null));
    expect(await getAvailability(person.id)).toEqual(person.freeTimes);
  });

  it("saves and clears availability and syncs search without passing replacement evidence", async () => {
    const updated = { ...person, freeTimes: [] };
    query.mockResolvedValueOnce(result(updated));
    expect(await saveAvailability(person.id, [])).toEqual([]);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/set "free_times" = \$\d+, "revision" = "users"\."revision" \+ 1 where "users"\."id" = \$\d+ returning/);
    expect(params).toEqual(["[]", person.id]);
    expect(ingestPerson).toHaveBeenCalledWith(updated, undefined, 1);
  });

  it("keeps pre-onboarding availability durable without indexing an incomplete Person", async () => {
    query.mockResolvedValueOnce(result(person, null));
    expect(await saveAvailability(person.id, person.freeTimes)).toEqual(person.freeTimes);
    expect(ingestPerson).not.toHaveBeenCalled();
  });

  it.each([
    { start: "2026-11-09T10:00:00Z", end: "2026-11-09T09:00:00Z" },
    { start: "2026-11-09T10:00:00Z", end: "2026-11-09T10:00:00Z" },
  ])("rejects nonpositive time intervals through both write paths", async (slot) => {
    await expect(saveAvailability(person.id, [slot])).rejects.toMatchObject({ status: 400 });
    await expect(updateProfile(person.id, { freeTimes: [slot] })).rejects.toMatchObject({ status: 400 });
    expect(query).not.toHaveBeenCalled();
  });

  it("reports storage outages without leaking connection details", async () => {
    query.mockRejectedValueOnce(new Error("postgres://secret-password@private-host"));
    const error = await getProfile(person.id).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 503 });
    expect(String(error)).not.toContain("secret-password");
  });

  it("reports a search failure as a saved write with a retryable sync error", async () => {
    ingestPerson.mockRejectedValueOnce(new Error("private-search-token"));
    const error = await saveAvailability(person.id, person.freeTimes).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 503 });
    expect(String(error)).toMatch(/saved/i);
    expect(String(error)).not.toContain("private-search-token");
    expect(await saveAvailability(person.id, person.freeTimes)).toEqual(person.freeTimes);
  });
});

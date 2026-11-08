import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { people } from "@/contracts/fixtures";
import { routes } from "@/contracts/routes";
import type { EvidenceDoc, Person } from "@/contracts/types";

const { query, ingestPerson } = vi.hoisted(() => ({ query: vi.fn(), ingestPerson: vi.fn() }));
vi.mock("@neondatabase/serverless", async (importOriginal) => ({
  ...await importOriginal<typeof import("@neondatabase/serverless")>(), neon: () => ({ query }),
}));
vi.mock("@/server/search", () => ({ search: { ingestPerson } }));
import { getProfile, updateProfile, getAvailability, saveAvailability, syncProfile } from "./service";

const person = structuredClone(people[0]);
function result(value: Person = person, filters: Person["filters"] | null = value.filters, revision = 1, evidence: unknown = [], pending = false) {
  return { rows: [[value.id, value.githubLogin, value.name, value.bio,
    JSON.stringify(value.languages), JSON.stringify(value.organisations),
    filters === null ? null : JSON.stringify(filters), JSON.stringify(value.freeTimes), "2026-11-05T00:00:00Z", revision,
    value.workplaceName ?? null, value.badgeColour ?? "sunflower", JSON.stringify(value.visibility ?? { country: true, workplace: true, hiring: true }), JSON.stringify(evidence), pending,
    // The avatar column is last; rows from before it existed simply end earlier.
    ...(value.avatar === undefined ? [] : [value.avatar])]] };
}
const evidence: EvidenceDoc[] = [{ id: `${person.id}:repo:durable`, personId: person.id,
  kind: "repo", title: "DurableRepository", text: "Repository evidence", url: "https://github.com/example/durable" }];
beforeEach(() => {
  query.mockReset().mockResolvedValue(result());
  ingestPerson.mockReset().mockResolvedValue(undefined);
  vi.stubEnv("DATABASE_URL", "postgresql://unused:unused@example.invalid/unused");
});
afterEach(() => vi.unstubAllEnvs());

describe("real profile and availability services", () => {
  it("does not write caller-supplied GitHub identity, even when invoked without the HTTP parser", async () => {
    const saved = await updateProfile(person.id, { githubLogin: "another-person" } as never);
    expect(saved.githubLogin).toBe(person.githubLogin);
    expect(query).toHaveBeenCalledOnce();
    expect(String(query.mock.calls[0][0])).not.toContain('update "users"');
  });
  it("syncs to the search it is given, and acknowledges only that write", async () => {
    const target = { ingestPerson: vi.fn().mockResolvedValue(undefined) };
    const user = {
      ...person, createdAt: new Date("2026-11-05T00:00:00Z"), revision: 4, workplaceName: null,
      badgeColour: "sunflower" as const, visibility: { country: true, workplace: true, hiring: true },
      githubEvidence: evidence, githubEvidencePending: true, avatar: null,
    };
    const synced = { ...person, avatar: null }; // no picture chosen: initials

    await expect(syncProfile(user, target as never)).resolves.toEqual(synced);

    expect(target.ingestPerson).toHaveBeenCalledExactlyOnceWith(synced, evidence, 4);
    expect(ingestPerson).not.toHaveBeenCalled(); // the app's own search is untouched
    expect(query).toHaveBeenCalledOnce();
    expect(String(query.mock.calls[0][0])).toContain('update "users" set "github_evidence_pending"');
  });

  it("replays durable evidence on an empty save after a restart, without exposing storage fields", async () => {
    query.mockResolvedValue(result(person, person.filters, 4, evidence));
    const restored = await updateProfile(person.id, {});
    expect(restored).toEqual(person);
    expect(restored).not.toHaveProperty("githubEvidence");
    expect(restored).not.toHaveProperty("githubEvidencePending");
    expect(ingestPerson).toHaveBeenCalledExactlyOnceWith(person, evidence, 4);
    expect(query).toHaveBeenCalledOnce();
  });

  it("indexes the saved evidence when onboarding completes and acknowledges only that revision", async () => {
    query.mockResolvedValueOnce(result(person, null, 0, evidence, true))
      .mockResolvedValueOnce(result(person, person.filters, 1, evidence, true));
    await updateProfile(person.id, { filters: person.filters });
    expect(ingestPerson).toHaveBeenCalledExactlyOnceWith(person, evidence, 1);
    expect(query.mock.calls[2][0]).toContain('where ("users"."id" = $2 and "users"."revision" = $3)');
    expect(query.mock.calls[2][1]).toEqual([false, person.id, 1]);
  });

  it("keeps evidence during an availability save and repairs a failed acknowledgement on retry", async () => {
    query.mockResolvedValueOnce(result(person, person.filters, 5, evidence, true))
      .mockRejectedValueOnce(new Error("private-database-credentials"));
    const error = await saveAvailability(person.id, person.freeTimes).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 503 });
    expect(String(error)).toContain("Profile saved");
    expect(String(error)).not.toContain("private-database-credentials");
    expect(ingestPerson).toHaveBeenCalledWith(person, evidence, 5);
    query.mockResolvedValueOnce(result(person, person.filters, 6, evidence, true));
    expect(await saveAvailability(person.id, person.freeTimes)).toEqual(person.freeTimes);
    expect(query.mock.calls.at(-1)?.[1]).toEqual([false, person.id, 6]);
  });

  it.each([null, {}, [{ ...evidence[0], personId: "another-user" }],
    [{ ...evidence[0], kind: "talk" }], Array.from({ length: 21 }, () => evidence[0])])(
    "refuses malformed or foreign saved evidence before indexing: %j", async docs => {
      query.mockResolvedValue(result(person, person.filters, 1, docs));
      await expect(updateProfile(person.id, {})).rejects.toMatchObject({ status: 503 });
      expect(ingestPerson).not.toHaveBeenCalled();
    },
  );

  it("does not mark evidence synchronized when search fails", async () => {
    query.mockResolvedValue(result(person, person.filters, 7, evidence, true));
    ingestPerson.mockRejectedValueOnce(new Error("private-search-token"));
    await expect(updateProfile(person.id, {})).rejects.toMatchObject({ status: 503 });
    expect(query).toHaveBeenCalledOnce();
  });
  it("persists visibility while keeping hidden fields available to the owner and search", async () => {
    const visibility = { country: false, workplace: false, hiring: false };
    const updated = { ...person, visibility };
    query.mockResolvedValueOnce(result()).mockResolvedValueOnce(result(updated));
    expect(await updateProfile(person.id, { visibility })).toEqual(updated);
    expect(query.mock.calls[1][1]).toEqual([JSON.stringify(visibility), person.id]);
    expect(ingestPerson).toHaveBeenCalledWith(updated, [], 1);
    query.mockResolvedValueOnce(result(updated));
    expect(await getProfile(person.id)).toEqual(updated);
  });
  it("persists the chosen picture in Postgres and passes it to search", async () => {
    const updated = { ...person, avatar: "moon" as const };
    query.mockResolvedValueOnce(result()).mockResolvedValueOnce(result(updated));
    expect(await updateProfile(person.id, { avatar: "moon" })).toEqual(updated);
    expect(query.mock.calls[1][0]).toContain('"avatar" =');
    expect(query.mock.calls[1][1]).toEqual(["moon", person.id]);
    expect(ingestPerson).toHaveBeenCalledWith(updated, [], 1);
    query.mockResolvedValueOnce(result(updated));
    expect(await getProfile(person.id)).toEqual(updated);
    // Back to initials.
    query.mockResolvedValueOnce(result(updated)).mockResolvedValueOnce(result({ ...person, avatar: null }));
    expect((await updateProfile(person.id, { avatar: null })).avatar).toBeNull();
  });

  it("refuses a stored picture that isn't one of the built-in ones", async () => {
    query.mockResolvedValueOnce(result({ ...person, avatar: "photo.jpg" as never }));
    await expect(getProfile(person.id)).rejects.toMatchObject({ status: 503 });
  });

  it("persists workplace and colour in Postgres and passes them to search", async () => {
    const updated = { ...person, workplaceName: "Acme Robotics", badgeColour: "lilac" as const };
    query.mockResolvedValueOnce(result()).mockResolvedValueOnce(result(updated));
    expect(await updateProfile(person.id, { workplaceName: updated.workplaceName, badgeColour: updated.badgeColour })).toEqual(updated);
    expect(query.mock.calls[1][0]).toContain('"workplace_name" =');
    expect(query.mock.calls[1][0]).toContain('"badge_colour" =');
    expect(query.mock.calls[1][1]).toEqual(["Acme Robotics", "lilac", person.id]);
    expect(ingestPerson).toHaveBeenCalledWith(updated, [], 1);
    query.mockResolvedValueOnce(result(updated));
    expect(await getProfile(person.id)).toEqual(updated);
  });

  it("clears a previous workplace label atomically when a legacy client changes ROR ID", async () => {
    const original = { ...person, workplaceName: "Original workplace" };
    const updated = { ...original, workplaceName: null, filters: { ...person.filters, rorId: null } };
    query.mockResolvedValueOnce(result(original)).mockResolvedValueOnce(result(updated));
    expect(await updateProfile(person.id, { filters: updated.filters })).toEqual(updated);
    expect(query.mock.calls[1][0]).toContain('case when "users"."filters"->>\'rorId\' is distinct from');
    expect(query.mock.calls[1][0]).toContain('then null else "users"."workplace_name" end');
  });
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
    expect(ingestPerson).toHaveBeenCalledWith(person, [], 1);
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
    expect(ingestPerson).toHaveBeenCalledWith(updated, [], 1);
  });

  it("handles an empty patch without issuing an invalid empty UPDATE", async () => {
    expect(await updateProfile(person.id, {})).toEqual(person);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("reads availability even before onboarding is complete", async () => {
    query.mockResolvedValueOnce(result(person, null));
    expect(await getAvailability(person.id)).toEqual(person.freeTimes);
  });

  it("saves and clears availability and syncs the saved evidence with availability", async () => {
    const updated = { ...person, freeTimes: [] };
    query.mockResolvedValueOnce(result(updated));
    expect(await saveAvailability(person.id, [])).toEqual([]);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/set "free_times" = \$\d+, "revision" = "users"\."revision" \+ 1 where "users"\."id" = \$\d+ returning/);
    expect(params).toEqual(["[]", person.id]);
    expect(ingestPerson).toHaveBeenCalledWith(updated, [], 1);
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

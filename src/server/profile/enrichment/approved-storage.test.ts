import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { users } from "../../../../db/schema";
import { people } from "@/contracts/fixtures";
import { emptyOwnerData, enrichmentError } from "./model";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@neondatabase/serverless", async original => ({ ...await original<typeof import("@neondatabase/serverless")>(), neon: () => ({ query: mocks.query }) }));
import { mutateApprovedProfile } from "./approved-storage";
const owner = people[0].id;
const initial = () => ({ ...people[0], createdAt: new Date("2026-11-07T12:00:00Z"), revision: 5, textVersion: 2, expertise: null,
  githubEvidence: [], githubEvidencePending: false, profileEvidence: [], profileSources: [], profileEvidencePending: false,
  workplaceName: null, badgeColour: "mint" as const, avatar: null, avatarColour: null,
  contactEmail: null, contactPhone: null, contactShare: "email" as const, visibility: { country: true, workplace: true, hiring: true } });
type User = typeof users.$inferSelect;
const raw = (user: User) => ({ rows: [Object.keys(getTableColumns(users)).map(key => {
  const value = user[key as keyof User]; return value instanceof Date ? value.toISOString() : value;
})] });
const state = (version = 1) => ({ rows: [[owner, version, emptyOwnerData(), null]] });
beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "postgresql://unused:unused@example.invalid/unused");
  mocks.query.mockReset().mockImplementation(async (statement: string) => statement.trimStart().startsWith("with locked")
    ? { rows: [{ saved: "1", staged: "1" }] } : statement.includes('from "users"') ? raw(initial()) : state());
});
afterEach(() => vi.unstubAllEnvs());
it("commits profile and private document through one guarded SQL statement", async () => {
  const saved = await mutateApprovedProfile(owner, (user, data) => { user.bio = "Approved"; user.profileEvidencePending = true; data.generation++; return true; });
  expect(saved).toMatchObject({ bio: "Approved", revision: 6 });
  const [statement, params] = mocks.query.mock.calls.find(([s]) => String(s).trimStart().startsWith("with locked"))!;
  expect(statement).toContain("for update of u, s");
  expect(statement).toContain('update "users"'); expect(statement).toContain('update "profile_enrichment_states"');
  expect(statement).toContain("u.revision ="); expect(statement).toContain("s.version =");
  expect(params).toContain(5); expect(params).toContain(1);
  expect(params.some((p: unknown) => typeof p === "string" && p.includes('"generation":1'))).toBe(true);
});
it("re-reads both revisions after losing a race and preserves the newer profile fields", async () => {
  let commits = 0;
  mocks.query.mockImplementation(async (statement: string) => {
    if (statement.trimStart().startsWith("with locked")) return { rows: [{ saved: String(++commits > 1 ? 1 : 0), staged: String(commits > 1 ? 1 : 0) }] };
    if (statement.includes('from "users"')) return raw({ ...initial(), revision: commits ? 6 : 5, bio: commits ? "Concurrent edit" : "Before" });
    return state(commits ? 2 : 1);
  });
  const saved = await mutateApprovedProfile(owner, (user, data) => { user.profileEvidencePending = true; data.generation++; return true; });
  expect(saved).toMatchObject({ bio: "Concurrent edit", revision: 7 }); expect(commits).toBe(2);
});
it("an idempotent replay does not rewrite either row and rereads after observing the receipt", async () => {
  await mutateApprovedProfile(owner, () => false);
  expect(mocks.query).toHaveBeenCalledTimes(3);
});
it("an approval receipt committed between independent reads repairs the newly saved revision", async () => {
  let reads = 0;
  mocks.query.mockImplementation(async (statement: string) => statement.includes('from "users"')
    ? raw({ ...initial(), revision: ++reads === 1 ? 5 : 6, bio: reads === 1 ? "Before approval" : "Approved text" }) : state(2));
  const saved = await mutateApprovedProfile(owner, () => false);
  expect(saved).toMatchObject({ revision: 6, bio: "Approved text" });
});
it("sanitizes a storage failure, including raw SQL/private parameters", async () => {
  mocks.query.mockRejectedValueOnce(new Error("private-cv and database-password"));
  const error = await mutateApprovedProfile(owner, () => true).catch(e => e);
  expect(error).toMatchObject({ code: "provider_down", status: 503 });
  expect(String(error)).not.toMatch(/private-cv|database-password/); expect(error).not.toHaveProperty("cause");
});
it("bounds contention retries without returning an unsaved success", async () => {
  mocks.query.mockImplementation(async (statement: string) => statement.trimStart().startsWith("with locked")
    ? { rows: [{ saved: "0", staged: "0" }] } : statement.includes('from "users"') ? raw(initial()) : state());
  await expect(mutateApprovedProfile(owner, () => true)).rejects.toMatchObject({ code: "running", status: 409 });
  expect(mocks.query).toHaveBeenCalledTimes(15);
});
it("initializes missing private state before committing a legacy profile mutation", async () => {
  let initialized = false;
  mocks.query.mockImplementation(async (statement: string) => {
    if (statement.startsWith("insert")) { initialized = true; return { rows: [[owner]] }; }
    if (statement.trimStart().startsWith("with locked")) return { rows: [{ saved: "1", staged: "1" }] };
    return statement.includes('from "users"') ? raw(initial()) : initialized ? state() : { rows: [] };
  });
  expect((await mutateApprovedProfile(owner, user => { user.bio = "Legacy profile"; return true; })).bio).toBe("Legacy profile");
  expect(initialized).toBe(true);
});
it("a source removal that wins the CAS race prevents the old draft from committing", async () => {
  let commits = 0;
  mocks.query.mockImplementation(async (statement: string) => {
    if (statement.trimStart().startsWith("with locked")) { commits++; return { rows: [{ saved: "0", staged: "0" }] }; }
    if (statement.includes('from "users"')) return raw(initial());
    const data = emptyOwnerData(); data.generation = commits;
    return { rows: [[owner, commits + 1, data, null]] };
  });
  await expect(mutateApprovedProfile(owner, (_user, data) => {
    if (data.generation !== 0) enrichmentError("consent_changed");
    return true;
  })).rejects.toMatchObject({ code: "consent_changed", status: 409 });
  expect(commits).toBe(1);
});

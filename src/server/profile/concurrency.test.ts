import { afterEach, expect, it, vi } from "vitest";
import { people } from "@/contracts/fixtures";
import type { EvidenceDoc, Person } from "@/contracts/types";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/server/config", () => ({ config: { fakeApi: false, fakeSearch: true } }));
vi.mock("@neondatabase/serverless", async (importOriginal) => ({
  ...await importOriginal<typeof import("@neondatabase/serverless")>(), neon: () => ({ query }),
}));
import { updateProfile, saveAvailability } from "./service";
import { getPerson, memorySearch } from "@/server/search/memory";
import { initializeGitHubProfile } from "./persistence";

function row(person: Person, revision: number, evidence: EvidenceDoc[] = [], pending = false) {
  return { rows: [[person.id, person.githubLogin, person.name, person.bio,
    JSON.stringify(person.languages), JSON.stringify(person.organisations), JSON.stringify(person.filters),
    JSON.stringify(person.freeTimes), "2026-11-05T00:00:00Z", revision,
    person.workplaceName ?? null, person.badgeColour ?? "sunflower", JSON.stringify(person.visibility), JSON.stringify(evidence), pending]] };
}
afterEach(() => vi.unstubAllEnvs());

it("rebuilds repository search results from the saved snapshot without another GitHub request", async () => {
  vi.stubEnv("DATABASE_URL", "postgresql://unused:unused@example.invalid/unused");
  const person = { ...structuredClone(people[0]), id: "durable-evidence-test" };
  const evidence: EvidenceDoc[] = [{ id: "durable-evidence-test:repo:source", personId: person.id,
    kind: "repo", title: "DurableSnapshotNeedle", text: "Repository description" }];
  query.mockReset().mockResolvedValue(row(person, 1, evidence));
  expect((await memorySearch.searchCandidates("DurableSnapshotNeedle", { excludeIds: [] })).length).toBe(0);
  await updateProfile(person.id, {});
  expect((await memorySearch.searchCandidates("DurableSnapshotNeedle", { excludeIds: [] })).map(hit => hit.person.id)).toEqual([person.id]);
  await memorySearch.ingestPerson(person, [], 1);
  expect((await memorySearch.searchCandidates("DurableSnapshotNeedle", { excludeIds: [] })).length).toBe(0);
  await updateProfile(person.id, {});
  expect((await memorySearch.searchCandidates("DurableSnapshotNeedle", { excludeIds: [] })).map(hit => hit.person.id)).toEqual([person.id]);
  expect(query.mock.calls.every(([sql]) => sql.startsWith("select"))).toBe(true);
});

it("cannot restore revoked repository evidence when an older save finishes after sign-in", async () => {
  vi.stubEnv("DATABASE_URL", "postgresql://unused:unused@example.invalid/unused");
  const original = { ...structuredClone(people[0]), id: "github:909", githubLogin: "race-user" };
  const evidence: EvidenceDoc[] = [{ id: "github:909:repo:old", personId: original.id, kind: "repo",
    title: "RevokedRepositoryNeedle", text: "Old repository evidence" }];
  await memorySearch.ingestPerson(original, evidence, 0);
  let finishOld!: (value: ReturnType<typeof row>) => void;
  const delayed = new Promise<ReturnType<typeof row>>(resolve => { finishOld = resolve; });
  let committed!: () => void;
  const firstSaved = new Promise<void>(resolve => { committed = resolve; });
  query.mockReset().mockResolvedValue({ rows: [] });
  query.mockResolvedValueOnce(row(original, 0, evidence))
    .mockImplementationOnce(() => { committed(); return delayed; })
    .mockResolvedValueOnce(row(original, 2, [], true));
  const older = updateProfile(original.id, { bio: original.bio });
  await firstSaved;
  await initializeGitHubProfile("909", { id: 909, login: "race-user", name: "Race" }, "test-token", []);
  finishOld(row(original, 1, evidence, true));
  await older;
  expect((await memorySearch.searchCandidates("RevokedRepositoryNeedle", { excludeIds: [] }))
    .some(candidate => candidate.person.id === original.id)).toBe(false);
  expect(query.mock.calls[3][1]).toEqual([false, original.id, 2]);
  expect(query.mock.calls[4][1]).toEqual([false, original.id, 1]);
  expect(query.mock.calls[4][0]).toContain('"users"."revision" = $3');
});

it("keeps the latest search metadata when an older database response arrives last", async () => {
  vi.stubEnv("DATABASE_URL", "postgresql://unused:unused@example.invalid/unused");
  const original = { ...structuredClone(people[0]), id: "concurrent-profile-test" };
  const first = { ...original, name: "New name" };
  const latest = { ...first, freeTimes: [] };
  let finishFirst!: (value: ReturnType<typeof row>) => void;
  const delayedReply = new Promise<ReturnType<typeof row>>((resolve) => { finishFirst = resolve; });
  let firstCommitted!: () => void;
  const committed = new Promise<void>((resolve) => { firstCommitted = resolve; });
  query.mockResolvedValueOnce(row(original, 0))
    .mockImplementationOnce(() => { firstCommitted(); return delayedReply; })
    .mockResolvedValueOnce(row(latest, 2));

  const pending = updateProfile(original.id, { name: first.name });
  await committed;
  await saveAvailability(original.id, []);
  finishFirst(row(first, 1));
  await pending;

  expect(getPerson(original.id)).toEqual(latest);
});

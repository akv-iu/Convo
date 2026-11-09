import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { people } from "@/contracts/fixtures";
import type { RouteBody } from "@/contracts/routes";
import { emptyOwnerData, type OwnerData } from "./model";
import type { users } from "../../../../db/schema";

type User = typeof users.$inferSelect;
const mocks = vi.hoisted(() => ({ user: null as User | null, data: null as OwnerData | null, writes: 0, sync: vi.fn() }));
vi.mock("../service", () => ({ readUser: async () => structuredClone(mocks.user), syncProfile: mocks.sync,
  toPerson: (user: User) => ({ ...people[0], bio: user.bio, expertise: user.expertise }) }));
vi.mock("./approved-storage", () => ({
  mutateApprovedProfile: async (owner: string, change: (user: User, data: OwnerData) => boolean) => {
    if (owner !== mocks.user!.id) throw Object.assign(new Error("Not found"), { code: "not_found", status: 404 });
    const user = structuredClone(mocks.user!); const data = structuredClone(mocks.data!);
    if (change(user, data)) { user.revision++; mocks.writes++; mocks.user = user; mocks.data = data; }
    return structuredClone(mocks.user!);
  },
}));
import { acceptEnrichment, enrichmentSources, removeEnrichmentSource } from "./approval";

const owner = people[0].id;
const now = "2026-11-07T12:00:00.000Z";
const paper = { id: `${owner}:paper:one`, personId: owner, sourceId: `${owner}:research`, source: "research" as const, kind: "paper" as const,
  title: "A paper", excerpt: "Approved professional work", url: "https://example.org/paper", retrievedAt: now };
const cv = { ...paper, id: `${owner}:cv:one`, sourceId: `${owner}:cv`, source: "cv" as const, kind: "cv" as const, title: "Professional CV excerpt", url: undefined };
const body = (): RouteBody<"acceptEnrichment"> => ({ draftVersion: 1, baseTextVersion: 3, bio: "My edited draft", expertise: ["Research"], evidenceIds: [paper.id] });
function stagePrivateInputs() {
  const uploadId = crypto.randomUUID();
  mocks.data!.cv = { text: "Private CV contact details", metadata: { uploadId, filename: "cv.pdf", characters: 26, warnings: [],
    expiresAt: new Date(Date.now()+86_400_000).toISOString() } };
  mocks.data!.jobs[0].input = { identity: { name: "My name", country: "US", workplaceName: null, rorId: null, orcid: null }, idempotencyKey: crypto.randomUUID(),
    github: { import: false, bio: false, repos: false, orgs: false }, research: null,
    publicProfile: { kind: "text", text: "Private public-profile paste" }, cv: { uploadId } };
  return uploadId;
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(now)); mocks.writes = 0;
  mocks.user = { ...people[0], createdAt: new Date(now), revision: 8, textVersion: 3, expertise: null, profileEvidence: [], profileSources: [],
    profileEvidencePending: false, githubEvidence: [], githubEvidencePending: false, workplaceName: "My workplace", badgeColour: "mint", avatar: "moon", avatarColour: null,
    visibility: { country: false, workplace: false, hiring: false } };
  mocks.data = emptyOwnerData(); mocks.data.generation = 2;
  const sources = (["github", "research", "public_profile", "cv"] as const).map(source => ({ source, sourceId: `${owner}:${source}`,
    status: source === "research" || source === "cv" ? "done" as const : "not_selected" as const,
    items: source === "research" || source === "cv" ? 1 : 0, selection: source === "research" || source === "cv" ? { label: source } : null }));
  mocks.data.jobs = [{ key: crypto.randomUUID(), fingerprint: "start", input: null, lease: null, collected: [paper, cv], baseTextVersion: 3,
    value: { jobId: "job", state: "ready", phase: "done", selectionGeneration: 2, sources, expiresAt: new Date(Date.now()+86_400_000).toISOString(),
      draft: { draftVersion: 1, baseTextVersion: 3, bio: body().bio, bioEvidenceIds: [paper.id], expertise: [{ label: "Research", evidenceIds: [paper.id] }], evidence: [paper, cv], needsReview: false } } }];
  mocks.sync.mockReset().mockImplementation(async (user: User) => ({ ...people[0], bio: user.bio, expertise: user.expertise }));
});
afterEach(() => vi.useRealTimers());

it("approves only selected excerpts, preserves badge/privacy/availability, and erases private collected material", async () => {
  mocks.data!.jobs[0].synthesisCacheKeys = ["profile:owner:hash"];
  const preferences = { avatar: mocks.user!.avatar, visibility: mocks.user!.visibility, freeTimes: mocks.user!.freeTimes };
  const result = await acceptEnrichment(owner, "job", body());
  expect(result.sync).toEqual({ status: "confirmed", retryable: false, savedRevision: 9 });
  expect(mocks.user).toMatchObject({ ...preferences, bio: "My edited draft", expertise: ["Research"], textVersion: 4, profileEvidence: [paper] });
  expect(mocks.data!.jobs[0]).toMatchObject({ input: null, collected: [], value: { state: "accepted", draft: null } });
  expect(mocks.data!.jobs[0]).not.toHaveProperty("synthesisCacheKeys");
  expect(mocks.user!.profileEvidence?.some(e => e.source === "cv")).toBe(false);
});
it("returns a saved revision after indexing fails, then repairs an identical retry without saving twice", async () => {
  mocks.sync.mockRejectedValueOnce(new Error("secret-search-token"));
  expect((await acceptEnrichment(owner, "job", body())).sync).toEqual({ status: "pending", retryable: true, savedRevision: 9 });
  expect(mocks.user!.profileEvidencePending).toBe(true);
  expect((await acceptEnrichment(owner, "job", body())).sync.status).toBe("confirmed");
  expect(mocks.writes).toBe(1);
  await expect(acceptEnrichment(owner, "job", { ...body(), bio: "Different retry" })).rejects.toMatchObject({ code: "draft_superseded" });
});
it("stores an incomplete profile without pretending it was indexed", async () => {
  mocks.user!.filters = null;
  expect(await acceptEnrichment(owner, "job", body())).toEqual({ person: null, sync: { status: "not_onboarded", retryable: false, savedRevision: 9 } });
  expect(mocks.sync).not.toHaveBeenCalled();
});
it.each(["text", "consent", "draft", "duplicate", "foreign", "expired"])("rejects %s changes without saving anything", async scenario => {
  const input = body();
  if (scenario === "text") mocks.user!.textVersion++;
  if (scenario === "consent") mocks.data!.generation++;
  if (scenario === "draft") input.draftVersion++;
  if (scenario === "duplicate") input.evidenceIds.push(paper.id);
  if (scenario === "foreign") input.evidenceIds.push("another-owner:paper:one");
  if (scenario === "expired") mocks.data!.jobs[0].value.expiresAt = now;
  const codes = { text: "text_changed", consent: "consent_changed", draft: "draft_superseded", duplicate: "invalid_input", foreign: "invalid_input", expired: "draft_superseded" };
  await expect(acceptEnrichment(owner, "job", input)).rejects.toMatchObject({ code: codes[scenario as keyof typeof codes] });
  expect(mocks.writes).toBe(0); expect(mocks.sync).not.toHaveBeenCalled();
});
it("retains unrelated approved sources while replacing a completed source snapshot", async () => {
  mocks.user!.profileEvidence = [cv]; mocks.user!.profileSources = [{ id: cv.sourceId, source: "cv", label: "CV", evidenceCount: 1, approvedAt: now }];
  mocks.data!.jobs[0].value.sources[3] = { ...mocks.data!.jobs[0].value.sources[3], status: "not_selected", items: 0, selection: null };
  mocks.data!.jobs[0].collected = [paper]; mocks.data!.jobs[0].value.draft!.evidence = [paper];
  await acceptEnrichment(owner, "job", body());
  expect(mocks.user!.profileEvidence).toEqual([cv, paper]);
});
it("lists only the owner's active source metadata", async () => {
  await acceptEnrichment(owner, "job", body());
  expect(await enrichmentSources(owner)).toEqual(expect.arrayContaining([expect.objectContaining({ id: paper.sourceId, evidenceCount: 1 })]));
});
it("withdraws one source, keeps edited text and unrelated evidence, and invalidates old jobs", async () => {
  await acceptEnrichment(owner, "job", { ...body(), evidenceIds: [paper.id, cv.id] });
  const oldBio = mocks.user!.bio; const oldExpertise = mocks.user!.expertise;
  const removed = await removeEnrichmentSource(owner, paper.sourceId);
  expect(removed).toMatchObject({ removed: true, reviewBio: true, sync: { status: "confirmed" } });
  expect(mocks.user).toMatchObject({ bio: oldBio, expertise: oldExpertise, profileEvidence: [cv] });
  expect(mocks.data!.generation).toBe(3);
  expect(await enrichmentSources(owner)).not.toContainEqual(expect.objectContaining({ id: paper.sourceId }));
});
it("repeated withdrawal repairs indexing but never cancels a newer job", async () => {
  await acceptEnrichment(owner, "job", body()); await removeEnrichmentSource(owner, paper.sourceId);
  const newer = structuredClone(mocks.data!.jobs[0]); newer.value.jobId = "newer"; newer.value.state = "queued"; newer.accepted = undefined;
  mocks.data!.jobs.push(newer);
  mocks.sync.mockRejectedValueOnce(new Error("secret-provider-error"));
  expect((await removeEnrichmentSource(owner, paper.sourceId)).sync.status).toBe("pending");
  expect(mocks.data!.jobs.at(-1)?.value.state).toBe("queued");
  expect(mocks.writes).toBe(2);
});
it("refuses another owner's source ID without changing state", async () => {
  await expect(removeEnrichmentSource(owner, "other:research")).rejects.toMatchObject({ code: "not_found", status: 404 });
  expect(mocks.writes).toBe(0);
});
it("does not treat corrupt stored evidence on an indexing retry as a normal pending save", async () => {
  await acceptEnrichment(owner, "job", body());
  mocks.user!.profileEvidence = {} as never;
  await expect(acceptEnrichment(owner, "job", body())).rejects.toMatchObject({ status: 503 });
});
it("keeps approved evidence and its source when that source comes back empty, as the fake does", async () => {
  const research = { id: paper.sourceId, source: "research" as const, label: "OpenAlex author", evidenceCount: 1, approvedAt: now };
  mocks.user!.profileEvidence = [paper]; mocks.user!.profileSources = [research];
  mocks.data!.jobs[0].value.sources[1] = { ...mocks.data!.jobs[0].value.sources[1], status: "empty", items: 0 };
  mocks.data!.jobs[0].collected = [cv]; mocks.data!.jobs[0].value.draft!.evidence = [cv];
  await acceptEnrichment(owner, "job", { ...body(), evidenceIds: [cv.id] });
  expect(mocks.user!.profileEvidence).toEqual([paper, cv]);
  expect(mocks.user!.profileSources).toContainEqual(research);
});
it("does not approve evidence from a source whose collection was not successful", async () => {
  mocks.data!.jobs[0].value.sources[1].status = "failed";
  await expect(acceptEnrichment(owner, "job", body())).rejects.toMatchObject({ status: 503 });
  expect(mocks.writes).toBe(0);
});
it("erases the used CV and pasted input on approval while retaining only approved professional excerpts", async () => {
  const uploadId = stagePrivateInputs();
  await acceptEnrichment(owner, "job", body());
  expect(mocks.data!.cv).toBeNull();
  expect(mocks.data!.removedCvs).toContainEqual(expect.objectContaining({ id: uploadId }));
  expect(JSON.stringify(mocks.data)).not.toMatch(/Private CV contact details|Private public-profile paste/);
  expect(mocks.user!.profileEvidence).toEqual([paper]);
});
it("refuses a draft whose CV expired before approval", async () => {
  stagePrivateInputs(); mocks.data!.cv!.metadata.expiresAt = now;
  await expect(acceptEnrichment(owner, "job", body())).rejects.toMatchObject({ code: "cv_expired" });
  expect(mocks.writes).toBe(0); expect(mocks.sync).not.toHaveBeenCalled();
});
it("withdrawal fences in-progress work and erases its private input", async () => {
  mocks.user!.profileEvidence = [paper];
  mocks.user!.profileSources = [{ id: paper.sourceId, source: "research", label: "Research", evidenceCount: 1, approvedAt: now }];
  stagePrivateInputs(); mocks.data!.jobs[0].value.state = "running";
  mocks.data!.jobs[0].lease = { token: crypto.randomUUID(), expiresAt: Date.now()+90_000 };
  await removeEnrichmentSource(owner, paper.sourceId);
  expect(mocks.data!.jobs[0]).toMatchObject({ input: null, collected: [], lease: null, value: { state: "cancelled", draft: null } });
  expect(mocks.data!.cv).toBeNull();
  expect(mocks.data!.generation).toBe(3);
});

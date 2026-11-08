import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OwnerData, emptyOwnerData, INPUT_TTL_MS, LEASE_MS } from "./model";
import type { RouteBody } from "@/contracts/routes";
import { enrichmentIdentity, enrichmentStart } from "@/contracts/fixtures/enrichment";
import { fake } from "@/contracts/fake/handlers";
import type { EnrichmentJob } from "@/contracts/enrichment";

const mocks = vi.hoisted(() => ({ data: new Map<string, OwnerData>(), due: vi.fn(), defer: vi.fn() }));
vi.mock("./storage", () => ({
  mutateOwner: async <T>(owner: string, change: (data: OwnerData) => T): Promise<T> => {
    const data = structuredClone(mocks.data.get(owner) ?? emptyOwnerData());
    const result = change(data); mocks.data.set(owner, OwnerData.parse(data)); return structuredClone(result);
  },
  ownersDueForCleanup: mocks.due,
  deferCleanup: mocks.defer,
}));
import { cancelJob, claimJob, cleanupExpired, createJob, DISCOVERY_TTL_MS, failJob, finishDraft, getJob, readPrivateState, recordCollection, recordDiscovery, removeCv, reserveDiscovery, retryJob, saveIdentity, stageCvText } from "./state";
const owner = "google:101";
const activeInput = (): RouteBody<"startEnrichment"> => ({ ...enrichmentStart(), github: { import: false, bio: false, repos: false, orgs: false }, publicProfile: { kind: "text", text: "Private page input" } });
function evidence(source: "cv" | "public_profile" = "public_profile") {
  const kind = source === "cv" ? "cv" : "profile_page";
  return { id: `${owner}:${kind}:recorded`, personId: owner, sourceId: `${owner}:${source}`, source, kind,
    title: source === "cv" ? "CV excerpt" : "Profile text", excerpt: "Recorded professional work", retrievedAt: new Date().toISOString() };
}
function completed(sources: EnrichmentJob["sources"]) {
  return sources.map(s => s.status === "not_selected" ? s : { ...s, status: "done" as const, items: 1 });
}
it("finishes only a live collected draft, retaining its original text version across badge changes", async () => {
  const job = await createJob(owner, activeInput(), null, 7); const lease = await claimJob(owner, job.jobId);
  await recordCollection(owner, job.jobId, lease.token, completed(lease.value.sources), [evidence()]);
  const proposal = { bio: "Professional work", bioEvidenceIds: [evidence().id], expertise: [{ label: "Research", evidenceIds: [evidence().id] }] };
  const ready = await finishDraft(owner, job.jobId, lease.token, proposal);
  expect(ready).toMatchObject({ state: "ready", draft: { baseTextVersion: 7, draftVersion: 1, needsReview: false } });
  expect((await getJob(owner, job.jobId, 8)).draft?.needsReview).toBe(true);
  await expect(finishDraft(owner, job.jobId, lease.token, proposal)).rejects.toMatchObject({ code: "draft_superseded" });
});
it("rejects invented draft references and late cancelled workers", async () => {
  const job = await createJob(owner, activeInput(), null); const lease = await claimJob(owner, job.jobId);
  await recordCollection(owner, job.jobId, lease.token, completed(lease.value.sources), [evidence()]);
  await expect(finishDraft(owner, job.jobId, lease.token, { bio: "Wrong", bioEvidenceIds: ["foreign"], expertise: [] })).rejects.toMatchObject({ code: "invalid_input" });
  await cancelJob(owner, job.jobId);
  await expect(finishDraft(owner, job.jobId, lease.token, { bio: "Work", bioEvidenceIds: [evidence().id], expertise: [] })).rejects.toMatchObject({ code: "draft_superseded" });
});
it("keeps an all-source failure distinct from an empty successful/manual import", async () => {
  const job = await createJob(owner, activeInput(), null); const lease = await claimJob(owner, job.jobId);
  const progress = lease.value.sources.map(s => s.status === "not_selected" ? s : { ...s, status: "failed" as const, reason: "provider_down" as const });
  await recordCollection(owner, job.jobId, lease.token, progress, []);
  expect(await finishDraft(owner, job.jobId, lease.token, { bio: "", bioEvidenceIds: [], expertise: [] })).toMatchObject({ state: "failed", draft: null });
});
beforeEach(() => { mocks.data.clear(); mocks.due.mockReset().mockResolvedValue([]); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-07T12:00:00Z")); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it("keeps staged identity/CV owner-private and returns metadata only", async () => {
  await saveIdentity(owner, enrichmentIdentity);
  const cv = await stageCvText(owner, { consent: true, text: "Private CV input" });
  expect(await readPrivateState(owner)).toEqual({ identity: enrichmentIdentity, job: null, pendingCv: cv });
  expect(JSON.stringify(await readPrivateState(owner))).not.toContain("Private CV input");
  expect(await readPrivateState("google:other")).toEqual({ identity: null, job: null, pendingCv: null });
  expect(mocks.data.get(owner)?.cv?.text).toBe("Private CV input");
});
it.each(["0000-0002-1825-0097", "0000-0002-1694-233X"])("validates ORCID's checksum including X: %s", async orcid => {
  expect((await saveIdentity(owner, { ...enrichmentIdentity, orcid })).identity?.orcid).toBe(orcid);
});
it("rejects an ORCID with a correct shape but wrong checksum", async () => {
  expect(() => saveIdentity(owner, { ...enrichmentIdentity, orcid: "0000-0002-1825-0098" })).toThrow();
  expect(mocks.data.has(owner)).toBe(false);
});
it("replaces CV input and supports idempotent removal without allowing foreign access", async () => {
  const first = await stageCvText(owner, { consent: true, text: "First private CV" });
  const second = await stageCvText(owner, { consent: true, text: "Second private CV" });
  expect(JSON.stringify(mocks.data.get(owner))).not.toContain("First private CV");
  expect(await removeCv(owner, first.uploadId)).toEqual({ removed: true });
  await expect(removeCv("other", second.uploadId)).rejects.toMatchObject({ status: 404 });
  await removeCv(owner, second.uploadId); await removeCv(owner, second.uploadId);
  expect((await readPrivateState(owner)).pendingCv).toBeNull();
});
it("creates manual continuation without a lease, draft or model call", async () => {
  const input = activeInput(); input.publicProfile = null;
  const job = await createJob(owner, input, null);
  expect(job).toMatchObject({ state: "manual", phase: "done", draft: null });
  expect(mocks.data.get(owner)?.jobs[0].input).toBeNull();
});
it("replays identical starts after cancellation but rejects changed input with that key", async () => {
  const input = activeInput(); const job = await createJob(owner, input, null);
  await cancelJob(owner, job.jobId);
  expect(await createJob(owner, input, null)).toMatchObject({ jobId: job.jobId, state: "cancelled" });
  await expect(createJob(owner, { ...input, publicProfile: { kind: "text", text: "Edited private input" } }, null)).rejects.toMatchObject({ code: "idempotency_conflict" });
  expect(JSON.stringify(mocks.data.get(owner))).not.toContain("Private page input");
});
it("supersedes old work and makes its lease unable to write results", async () => {
  const first = await createJob(owner, activeInput(), null); const lease = await claimJob(owner, first.jobId);
  const replacement = await createJob(owner, activeInput(), null);
  expect((await getJob(owner, first.jobId)).state).toBe("superseded");
  await expect(recordCollection(owner, first.jobId, lease.token, completed(lease.value.sources), [evidence()])).rejects.toMatchObject({ code: "draft_superseded" });
  expect((await getJob(owner, replacement.jobId)).state).toBe("queued");
});
it("keeps a reused current CV while superseding its old job", async () => {
  const cv = await stageCvText(owner, { consent: true, text: "CV to reuse" });
  const first = await createJob(owner, { ...activeInput(), cv: { uploadId: cv.uploadId } }, null);
  await createJob(owner, { ...activeInput(), cv: { uploadId: cv.uploadId } }, null);
  expect((await getJob(owner, first.jobId)).state).toBe("superseded");
  expect((await readPrivateState(owner)).pendingCv?.uploadId).toBe(cv.uploadId);
});
it("rejects stale-tab identity and unconnected GitHub before starting", async () => {
  await saveIdentity(owner, { ...enrichmentIdentity, name: "Newer answer" });
  await expect(createJob(owner, activeInput(), null)).rejects.toMatchObject({ code: "selection_stale" });
  await expect(createJob("other", enrichmentStart(), null)).rejects.toMatchObject({ code: "github_not_connected" });
});
it("invalidates jobs and temporary inputs on identity change", async () => {
  const cv = await stageCvText(owner, { consent: true, text: "Sensitive old CV" });
  const job = await createJob(owner, { ...activeInput(), cv: { uploadId: cv.uploadId } }, null);
  await saveIdentity(owner, { ...enrichmentIdentity, name: "Changed identity" });
  expect((await getJob(owner, job.jobId)).state).toBe("superseded");
  expect(JSON.stringify(mocks.data.get(owner))).not.toMatch(/Sensitive old CV|Private page input/);
});
it("allows one lease, reports stalled after expiry, and requires a deliberate retry", async () => {
  const job = await createJob(owner, activeInput(), null);
  const attempts = await Promise.allSettled([claimJob(owner, job.jobId), claimJob(owner, job.jobId)]);
  expect(attempts.filter(r => r.status === "fulfilled")).toHaveLength(1);
  await expect(retryJob(owner, job.jobId)).rejects.toMatchObject({ code: "running", retryAfterSeconds: 90 });
  vi.advanceTimersByTime(LEASE_MS+1);
  expect((await getJob(owner, job.jobId)).state).toBe("stalled");
  expect((await retryJob(owner, job.jobId)).state).toBe("queued");
});
it.each(["new", "legacy"])("recovers an unclaimed %s job and gives a retry a fresh claim deadline", async version => {
  const job = await createJob(owner, activeInput(), null);
  if (version === "legacy") delete mocks.data.get(owner)!.jobs[0].queuedAt;
  vi.advanceTimersByTime(LEASE_MS - 1);
  expect((await getJob(owner, job.jobId)).state).toBe("queued");
  vi.advanceTimersByTime(1);
  expect((await getJob(owner, job.jobId)).state).toBe("stalled");
  expect((await retryJob(owner, job.jobId)).state).toBe("queued");
  await expect(retryJob(owner, job.jobId)).rejects.toMatchObject({ code: "running", retryAfterSeconds: 90 });
  vi.advanceTimersByTime(LEASE_MS - 1);
  expect((await getJob(owner, job.jobId)).state).toBe("queued");
  expect((await claimJob(owner, job.jobId)).value.state).toBe("running");
});
it("preserves successful source evidence across failure and retry, rejecting an old lease", async () => {
  const cv = await stageCvText(owner, { consent: true, text: "Private CV" });
  const job = await createJob(owner, { ...activeInput(), cv: { uploadId: cv.uploadId } }, null);
  const lease = await claimJob(owner, job.jobId);
  const progress = lease.value.sources.map(s => s.source === "public_profile" ? { ...s, status: "done" as const, items: 1 } : s);
  await recordCollection(owner, job.jobId, lease.token, progress, [evidence()]);
  await failJob(owner, job.jobId, lease.token, "timeout"); await retryJob(owner, job.jobId);
  const next = await claimJob(owner, job.jobId);
  expect(next.collected).toEqual([evidence()]); expect(next.input.cv?.uploadId).toBe(cv.uploadId);
  await expect(recordCollection(owner, job.jobId, lease.token, completed(next.value.sources), [evidence(), evidence("cv")])).rejects.toMatchObject({ code: "draft_superseded" });
  await recordCollection(owner, job.jobId, next.token, completed(next.value.sources), [evidence(), evidence("cv")]);
  expect((await getJob(owner, job.jobId)).phase).toBe("writing");
});
it("rejects foreign/cross-source evidence and manufactured evidence for switched-off sources", async () => {
  const job = await createJob(owner, activeInput(), null); const lease = await claimJob(owner, job.jobId);
  await expect(recordCollection(owner, job.jobId, lease.token, completed(lease.value.sources), [{ ...evidence(), personId: "other" }])).rejects.toMatchObject({ code: "invalid_input" });
  const cvOn = lease.value.sources.map(s => s.source === "cv" ? { ...s, status: "done" as const } : s);
  await expect(recordCollection(owner, job.jobId, lease.token, cvOn, [evidence("cv")])).rejects.toMatchObject({ code: "invalid_input" });
});
it("does not give pasted/CV evidence a public URL or erase already collected evidence", async () => {
  const job = await createJob(owner, activeInput(), null); const lease = await claimJob(owner, job.jobId);
  await expect(recordCollection(owner, job.jobId, lease.token, completed(lease.value.sources), [{ ...evidence(), url: "https://example.org" }])).rejects.toMatchObject({ code: "invalid_input" });
  await recordCollection(owner, job.jobId, lease.token, completed(lease.value.sources), [evidence()]);
  await expect(recordCollection(owner, job.jobId, lease.token, completed(lease.value.sources), [])).rejects.toMatchObject({ code: "invalid_input" });
});
it("purges expired CV/pasted input and draft material before returning status", async () => {
  const cv = await stageCvText(owner, { consent: true, text: "Secret expiry CV" });
  vi.advanceTimersByTime(3600_000);
  const job = await createJob(owner, { ...activeInput(), cv: { uploadId: cv.uploadId } }, null);
  vi.advanceTimersByTime(INPUT_TTL_MS-3600_000+1);
  const expired = await getJob(owner, job.jobId);
  expect(expired).toMatchObject({ state: "failed", draft: null });
  expect(expired.sources.find(s => s.source === "cv")?.reason).toBe("cv_expired");
  expect(JSON.stringify(mocks.data.get(owner))).not.toMatch(/Secret expiry CV|Private page input/);
  vi.advanceTimersByTime(3600_000);
  expect(await getJob(owner, job.jobId)).toEqual(expired);
  const unchanged = structuredClone(mocks.data.get(owner));
  await getJob(owner, job.jobId);
  expect(mocks.data.get(owner)).toEqual(unchanged);
  await expect(retryJob(owner, job.jobId)).rejects.toMatchObject({ code: "draft_superseded" });
});
it("keeps foreign jobs hidden and cancellation idempotent", async () => {
  const job = await createJob(owner, activeInput(), null);
  await expect(getJob("other", job.jobId)).rejects.toMatchObject({ status: 404 });
  await expect(cancelJob("other", job.jobId)).rejects.toMatchObject({ status: 404 });
  expect(await cancelJob(owner, job.jobId)).toEqual(await cancelJob(owner, job.jobId));
});
it("limits uploads durably and allows another window after its cooldown", async () => {
  for (let n=0;n<6;n++) await stageCvText(owner, { consent: true, text: "CV" });
  await expect(stageCvText(owner, { consent: true, text: "CV" })).rejects.toMatchObject({ status: 429, retryAfterSeconds: 600 });
  vi.advanceTimersByTime(600_001); await stageCvText(owner, { consent: true, text: "CV" });
});
it("binds discovery candidates to their owner and input and refuses changed inputs", async () => {
  const input = { source: "research" as const, name: enrichmentIdentity.name, workplaceName: enrichmentIdentity.workplaceName, rorId: null, orcid: null };
  const preview = { ...await fake.discoverEnrichment({ userId: "u_demo_a", params: {}, query: new URLSearchParams(), body: input }),
    expiresAt: new Date(Date.now() + DISCOVERY_TTL_MS).toISOString() };
  await saveIdentity(owner, enrichmentIdentity);
  await recordDiscovery(owner, input, preview, await reserveDiscovery(owner, input));
  const body = { ...activeInput(), research: { discoveryId: preview.discoveryId, candidateId: preview.candidates[0].id } };
  expect((await createJob(owner, body, null)).sources[1].selection?.url).toBe(preview.candidates[0].url);
  await expect(createJob("other", body, null)).rejects.toMatchObject({ code: "selection_stale" });
  await expect(createJob(owner, { ...body, idempotencyKey: crypto.randomUUID(), identity: { ...body.identity, name: "Changed name" } }, null)).rejects.toMatchObject({ code: "selection_stale" });
});
it("runs bounded physical cleanup without loading inputs into a public response", async () => {
  await stageCvText(owner, { consent: true, text: "Private cleanup text" });
  mocks.due.mockResolvedValue([owner]); vi.advanceTimersByTime(INPUT_TTL_MS+1);
  expect(await cleanupExpired()).toEqual({ processed: 1, failed: 0 });
  expect(mocks.data.get(owner)?.cv).toBeNull();
});

it("discards unused staged CV text when final confirmation turns CV off", async () => {
  await stageCvText(owner, { consent: true, text: "Unused private CV" });
  const input = activeInput(); input.publicProfile = null;
  await createJob(owner, input, null);
  expect((await readPrivateState(owner)).pendingCv).toBeNull();
  expect(JSON.stringify(mocks.data.get(owner))).not.toContain("Unused private CV");
});
it("keeps a GitHub reconnect failure separate from successful public-profile collection", async () => {
  const input = activeInput(); input.github.import = true; input.github.bio = true;
  const job = await createJob(owner, input, "demo-handle"); const lease = await claimJob(owner, job.jobId);
  const progress = completed(lease.value.sources).map(s => s.source === "github" ? { ...s, status: "failed" as const, items: 0, reason: "github_reconnect" as const } : s);
  const value = await recordCollection(owner, job.jobId, lease.token, progress, [evidence()]);
  expect(value.sources.find(s => s.source === "github")?.reason).toBe("github_reconnect");
  expect(value.sources.find(s => s.source === "public_profile")).toMatchObject({ status: "done", items: 1 });
});
it("never treats a cancelled job as waiting for another worker", async () => {
  const job = await createJob(owner, activeInput(), null); await cancelJob(owner, job.jobId);
  await expect(claimJob(owner, job.jobId)).rejects.toMatchObject({ code: "draft_superseded" });
});
it("resumes the writing phase without losing successfully collected sources", async () => {
  const job = await createJob(owner, activeInput(), null); const lease = await claimJob(owner, job.jobId);
  await recordCollection(owner, job.jobId, lease.token, completed(lease.value.sources), [evidence()]);
  await failJob(owner, job.jobId, lease.token, "provider_down");
  expect((await retryJob(owner, job.jobId)).phase).toBe("writing");
  const retried = await claimJob(owner, job.jobId);
  expect(retried.collected).toEqual([evidence()]);
  expect(retried.value.sources.find(s => s.source === "public_profile")?.status).toBe("done");
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_USER_A, DEMO_USER_B, DEMO_GOOGLE_NEW, DEMO_RESEARCHER } from "../fixtures";
import { enrichmentStart, enrichmentIdentity } from "../fixtures/enrichment";
import { routes, type Ctx, type RouteName } from "../routes";
import { EvidenceDoc } from "../types";
import { fake } from "./handlers";
import { store } from "./store";
import { search } from "@/server/search";

function ctx<N extends RouteName>(body?: unknown, userId = DEMO_USER_A, id = ""): Ctx<N> {
  return { userId, params: { id }, query: new URLSearchParams(), body } as Ctx<N>;
}
const discover = (source: "research" | "public_profile", name = enrichmentIdentity.name, userId = DEMO_USER_A) =>
  fake.discoverEnrichment(ctx({ source, name, workplaceName: enrichmentIdentity.workplaceName, rorId: null, orcid: null }, userId));
async function ready(input = enrichmentStart(), userId = DEMO_USER_A) {
  await fake.saveEnrichmentIdentity(ctx(input.identity, userId));
  const job = await fake.startEnrichment(ctx(input, userId));
  await fake.getEnrichment(ctx(undefined, userId, job.jobId));
  await fake.getEnrichment(ctx(undefined, userId, job.jobId));
  return fake.getEnrichment(ctx(undefined, userId, job.jobId));
}
function acceptance(job: Awaited<ReturnType<typeof ready>>) {
  return { draftVersion: job.draft!.draftVersion, baseTextVersion: job.draft!.baseTextVersion,
    bio: job.draft!.bio, expertise: job.draft!.expertise.map(e => e.label), evidenceIds: job.draft!.evidence.map(e => e.id) };
}
beforeEach(() => store.reset());
describe("revised enrichment contract", () => {
  it("discovers sources independently with bounded human-readable previews and recorded failures", async () => {
    for (const source of ["research","public_profile"] as const) {
      const found = routes.discoverEnrichment.response.parse(await discover(source));
      expect(found.candidates).toHaveLength(4);
      expect(found.candidates.every(c => c.url.startsWith("https://"))).toBe(true);
      expect(await discover(source, "[demo:no_matches]")).toMatchObject({ status: "no_matches", candidates: [] });
      expect(await discover(source, "[demo:unavailable]")).toMatchObject({ status: "unavailable", reason: "provider_down" });
    }
  });
  it("resumes a Google-only account and pending CV before onboarding, with no fabricated GitHub handle", async () => {
    const state = await fake.enrichmentState(ctx(undefined, DEMO_GOOGLE_NEW));
    expect(state).toMatchObject({ onboarded: false, signIn: { provider: "google" }, github: { connected: false, login: null } });
    await fake.saveEnrichmentIdentity(ctx(enrichmentIdentity, DEMO_GOOGLE_NEW));
    expect((await fake.enrichmentState(ctx(undefined, DEMO_GOOGLE_NEW))).identity).toEqual(enrichmentIdentity);
    await expect(fake.getMe(ctx(undefined, DEMO_GOOGLE_NEW))).rejects.toMatchObject({ status: 409 });
    const upload = await fake.uploadCv(ctx({ consent: true, text: "Private CV content" }, DEMO_GOOGLE_NEW));
    expect(await fake.enrichmentState(ctx(undefined, DEMO_GOOGLE_NEW))).toMatchObject({ pendingCv: { uploadId: upload.uploadId, filename: null } });
    const input = enrichmentStart(); input.github.import = false; input.cv = { uploadId: upload.uploadId };
    const job = await ready(input, DEMO_GOOGLE_NEW);
    const saved = routes.acceptEnrichment.response.parse(await fake.acceptEnrichment(ctx(acceptance(job), DEMO_GOOGLE_NEW, job.jobId)));
    expect(saved).toMatchObject({ person: null, sync: { status: "not_onboarded" } });
    expect(await fake.enrichmentState(ctx(undefined, DEMO_GOOGLE_NEW))).toMatchObject({ identity: enrichmentIdentity, pendingCv: null, job: { state: "accepted" } });
    expect(JSON.stringify(job)).not.toContain("Private CV content");
    const complete = await fake.putMe(ctx({ filters: { country: "US", rorId: null, hiring: false } }, DEMO_GOOGLE_NEW));
    expect(complete.githubLogin).toBeNull();
    expect(complete.bio).toBe(saved.person?.bio ?? job.draft!.bio);
  });
  it("requires a real recorded connection before GitHub import, keeps it server-owned and refuses linking elsewhere", async () => {
    await expect(fake.startEnrichment(ctx(enrichmentStart(), DEMO_GOOGLE_NEW))).rejects.toMatchObject({ code: "github_not_connected", status: 409 });
    expect(await fake.connectGitHub(ctx(undefined, DEMO_GOOGLE_NEW))).toMatchObject({ status: "connected", login: "demo-connected" });
    expect(await fake.enrichmentState(ctx(undefined, DEMO_GOOGLE_NEW))).toMatchObject({ signIn: { provider: "google" }, github: { connected: true, login: "demo-connected" } });
    await expect(fake.connectGitHub(ctx(undefined, DEMO_RESEARCHER))).rejects.toMatchObject({ code: "github_linked_elsewhere" });
  });

  it("keeps an owner signed in when a connection is cancelled and treats empty public data honestly", async () => {
    await fake.saveEnrichmentIdentity(ctx({ ...enrichmentIdentity, name: "[demo:connect_cancelled]" }, DEMO_GOOGLE_NEW));
    await expect(fake.connectGitHub(ctx(undefined, DEMO_GOOGLE_NEW))).rejects.toMatchObject({ code: "github_connect_cancelled" });
    expect((await fake.enrichmentState(ctx(undefined, DEMO_GOOGLE_NEW))).signIn.provider).toBe("google");
    const input = enrichmentStart(); input.identity.name = "[demo:empty]";
    const empty = await ready(input);
    expect(empty).toMatchObject({ state: "manual", draft: null });
    expect(empty.sources[0]).toMatchObject({ status: "empty", reason: "github_nothing_public" });
  });
  it("preserves identity for all-off manual onboarding and creates no draft", async () => {
    const input = enrichmentStart(); input.github.import = false;
    const job = await fake.startEnrichment(ctx(input, DEMO_GOOGLE_NEW));
    expect(job).toMatchObject({ state: "manual", phase: "done", draft: null });
    expect((await fake.enrichmentState(ctx(undefined, DEMO_GOOGLE_NEW))).identity).toEqual(input.identity);
  });

  it("does not permit enabled GitHub imports without a consented category", () => {
    const input = enrichmentStart(); input.github = { import: true, bio: false, repos: false, orgs: false };
    expect(routes.startEnrichment.body.safeParse(input).success).toBe(false);
    input.github.import = false;
    expect(routes.startEnrichment.body.safeParse(input).success).toBe(true);
  });
  it("uses owner-bound candidate selections and rejects changed discovery inputs", async () => {
    const research = await discover("research");
    const input = enrichmentStart(); input.research = { discoveryId: research.discoveryId, candidateId: research.candidates[0].id };
    await expect(fake.startEnrichment(ctx(input, DEMO_USER_B))).rejects.toMatchObject({ status: 404 });
    input.identity.name = "Different name";
    await expect(fake.startEnrichment(ctx(input))).rejects.toMatchObject({ code: "selection_stale" });
  });

  it("does not overwrite page-one answers saved by another tab", async () => {
    await fake.saveEnrichmentIdentity(ctx({ ...enrichmentIdentity, name: "Newer tab's answer" }));
    await expect(fake.startEnrichment(ctx(enrichmentStart()))).rejects.toMatchObject({ code: "selection_stale" });
    expect((await fake.enrichmentState(ctx())).identity?.name).toBe("Newer tab's answer");
  });
  it("snapshots four sources, connects claims to excerpts and requires explicit approval", async () => {
    const a = await discover("research"), p = await discover("public_profile");
    const upload = await fake.uploadCv(ctx({ consent: true, text: "Private CV" }));
    const input = enrichmentStart();
    input.research = { discoveryId: a.discoveryId, candidateId: a.candidates[0].id };
    input.publicProfile = { discoveryId: p.discoveryId, candidateId: p.candidates[0].id }; input.cv = { uploadId: upload.uploadId };
    const original = structuredClone(await fake.getMe(ctx()));
    const job = routes.getEnrichment.response.parse(await ready(input));
    expect(await fake.getMe(ctx())).toEqual(original);
    expect(job.draft!.evidence.map(e => e.kind)).toEqual(["repo","paper","profile_page","cv"]);
    expect(job.draft!.expertise[0].evidenceIds).toHaveLength(4);
    await fake.putMe(ctx({ badgeColour: "lilac", visibility: { country: false, workplace: false, hiring: false } }));
    await fake.putAvailability(ctx([]));
    const body = acceptance(job); body.evidenceIds = body.evidenceIds.filter(id => !id.includes(":cv:"));
    const saved = await fake.acceptEnrichment(ctx(body, DEMO_USER_A, job.jobId));
    expect(saved.person).toMatchObject({ badgeColour: "lilac", freeTimes: [], bio: body.bio });
    expect((await fake.enrichmentSources(ctx())).reduce((n,s) => n+s.evidenceCount,0)).toBe(3);
    expect((await fake.acceptEnrichment(ctx(body, DEMO_USER_A, job.jobId))).sync.savedRevision).toBe(saved.sync.savedRevision);
    await expect(fake.acceptEnrichment(ctx({ ...body, bio: "Different edits" }, DEMO_USER_A, job.jobId))).rejects.toMatchObject({ code: "draft_superseded" });
  });
  it("returns the same job for an identical key and 409 for edited pasted text, without retaining it", async () => {
    const input = enrichmentStart(); input.publicProfile = { kind: "text", text: "Owner's private professional text" };
    const job = await ready(input);
    expect((await fake.startEnrichment(ctx(input))).jobId).toBe(job.jobId);
    expect(JSON.stringify(store.get().enrichment.jobs.get(job.jobId))).not.toContain("Owner's private professional text");
    const excerpt = job.draft!.evidence.find(e => e.source === "public_profile")!;
    expect(excerpt).toMatchObject({ title: "Profile text", kind: "profile_page" });
    expect(excerpt).not.toHaveProperty("url");
    await expect(fake.startEnrichment(ctx({ ...input, publicProfile: { kind: "text", text: "Edited text" } }))).rejects.toMatchObject({ status: 409, code: "idempotency_conflict" });
    const replacement = await fake.startEnrichment(ctx({ ...input, idempotencyKey: crypto.randomUUID() }));
    expect(replacement.jobId).not.toBe(job.jobId);
    expect(await fake.getEnrichment(ctx(undefined, DEMO_USER_A, job.jobId))).toMatchObject({ state: "superseded", draft: null });
  });
  it("replaces pending CV input, supports idempotent removal and rejects expired input", async () => {
    const first = await fake.uploadCv(ctx({ consent: true, text: "First" }));
    const second = await fake.uploadCv(ctx({ consent: true, text: "Second" }));
    expect((await fake.enrichmentState(ctx())).pendingCv?.uploadId).toBe(second.uploadId);
    await expect(fake.startEnrichment(ctx({ ...enrichmentStart(), cv: { uploadId: first.uploadId } }))).rejects.toMatchObject({ code: "cv_expired" });
    await expect(fake.removeCv(ctx(undefined, DEMO_USER_B, second.uploadId))).rejects.toMatchObject({ status: 404 });
    await fake.removeCv(ctx(undefined, DEMO_USER_A, second.uploadId)); await fake.removeCv(ctx(undefined, DEMO_USER_A, second.uploadId));
    expect((await fake.enrichmentState(ctx())).pendingCv).toBeNull();
  });
  it("protects manual bio edits during collection, but permits retrying an actual failure with a new draft", async () => {
    const input = enrichmentStart();
    const started = await fake.startEnrichment(ctx(input));
    await fake.putMe(ctx({ bio: "Newer hand-written bio" }));
    await fake.getEnrichment(ctx(undefined, DEMO_USER_A, started.jobId)); await fake.getEnrichment(ctx(undefined, DEMO_USER_A, started.jobId));
    const job = await fake.getEnrichment(ctx(undefined, DEMO_USER_A, started.jobId));
    expect(job.draft?.needsReview).toBe(true);
    await expect(fake.acceptEnrichment(ctx(acceptance(job), DEMO_USER_A, job.jobId))).rejects.toMatchObject({ code: "text_changed" });
    const failing = enrichmentStart(); failing.identity.name = "[demo:partial]";
    failing.publicProfile = { kind: "text", text: "Recorded" };
    const partial = await ready(failing);
    expect(partial.state).toBe("partial");
    expect(partial.draft!.evidence.every(e => e.source !== "github")).toBe(true);
    await fake.retryEnrichment(ctx(undefined, DEMO_USER_A, partial.jobId));
    await fake.getEnrichment(ctx(undefined, DEMO_USER_A, partial.jobId)); await fake.getEnrichment(ctx(undefined, DEMO_USER_A, partial.jobId));
    const recovered = await fake.getEnrichment(ctx(undefined, DEMO_USER_A, partial.jobId));
    expect(recovered.draft!.draftVersion).toBe(2);
  });
  it.each(["failed","stalled","reconnect"] as const)("exercises the documented %s outcome", async scenario => {
    const input = enrichmentStart(); input.identity.name = "[demo:" + scenario + "]";
    const job = await ready(input);
    expect(job.state).toBe(scenario === "reconnect" ? "failed" : scenario);
    if (scenario === "reconnect") expect(job.sources[0].reason).toBe("github_reconnect");
  });
  it("blocks running retries, duplicate/foreign evidence, foreign jobs, cancelled drafts and expired drafts", async () => {
    const started = await fake.startEnrichment(ctx(enrichmentStart()));
    await expect(fake.retryEnrichment(ctx(undefined, DEMO_USER_A, started.jobId))).rejects.toMatchObject({ code: "running", retryAfterSeconds: 30 });
    const job = await ready();
    await expect(fake.acceptEnrichment(ctx({ ...acceptance(job), evidenceIds: ["foreign"] }, DEMO_USER_A, job.jobId))).rejects.toMatchObject({ code: "invalid_input" });
    await expect(fake.getEnrichment(ctx(undefined, DEMO_USER_B, job.jobId))).rejects.toMatchObject({ status: 404 });
    await fake.cancelEnrichment(ctx(undefined, DEMO_USER_A, job.jobId));
    await expect(fake.acceptEnrichment(ctx(acceptance(job), DEMO_USER_A, job.jobId))).rejects.toMatchObject({ code: "draft_superseded" });
    const expired = await ready(); store.get().enrichment.jobs.get(expired.jobId)!.value.expiresAt = "2000-01-01T00:00:00Z";
    expect((await fake.getEnrichment(ctx(undefined, DEMO_USER_A, expired.jobId))).draft).toBeNull();
  });
  it("withdraws evidence without restoring it on profile saves or cancelling newer jobs on repeat removal", async () => {
    const job = await ready(); await fake.acceptEnrichment(ctx(acceptance(job), DEMO_USER_A, job.jobId));
    const source = (await fake.enrichmentSources(ctx()))[0];
    const pending = await fake.startEnrichment(ctx(enrichmentStart()));
    await fake.removeEnrichmentSource(ctx(undefined, DEMO_USER_A, source.id));
    expect((await fake.getEnrichment(ctx(undefined, DEMO_USER_A, pending.jobId))).draft).toBeNull();
    expect((await fake.getEnrichment(ctx(undefined, DEMO_USER_A, job.jobId))).draft).toBeNull();
    await fake.putMe(ctx({ badgeColour: "mint" }));
    expect(store.get().enrichment.evidence.get(DEMO_USER_A)).toEqual([]);
    const newer = await fake.startEnrichment(ctx(enrichmentStart()));
    await fake.removeEnrichmentSource(ctx(undefined, DEMO_USER_A, source.id));
    expect((await fake.getEnrichment(ctx(undefined, DEMO_USER_A, newer.jobId))).state).toBe("running");
  });
  it("returns pending after an index failure and repairs an identical approval without saving twice", async () => {
    const job = await ready(); const spy = vi.spyOn(search, "ingestPerson").mockRejectedValueOnce(new Error("secret"));
    try {
      const saved = await fake.acceptEnrichment(ctx(acceptance(job), DEMO_USER_A, job.jobId));
      expect(saved.sync.status).toBe("pending");
      const retry = await fake.acceptEnrichment(ctx(acceptance(job), DEMO_USER_A, job.jobId));
      expect(retry.sync).toMatchObject({ status: "confirmed", savedRevision: saved.sync.savedRevision });
    } finally { spy.mockRestore(); }
  });
  it("lets the no-GitHub fixture match and send a real fake request to demo A", async () => {
    const ask = await fake.refine(ctx({ text: "qubitcalibration" }));
    expect((await fake.match(ctx({ askId: ask.askId })))[0].person).toMatchObject({ id: DEMO_RESEARCHER, githubLogin: null });
    const own = await fake.refine(ctx({ text: "Kubernetes" }, DEMO_RESEARCHER));
    await fake.sendRequest(ctx({ askId: own.askId, toPersonId: DEMO_USER_A }, DEMO_RESEARCHER));
    expect((await fake.inbox(ctx()))[0].person?.githubLogin).toBeNull();
  });
  it.each(["http://example.org","javascript:alert(1)","https://user:secret@example.org"])("rejects unsafe evidence links: %s", url => {
    expect(EvidenceDoc.safeParse({ id: "e", personId: "p", kind: "paper", title: "t", text: "t", url }).success).toBe(false);
  });
});

it("keeps parallel fresh Google users isolated through onboarding, uploads and recorded GitHub connections", async () => {
  const owners = ["u_google_new_parallel_a", "u_google_new_parallel_b"];
  await Promise.all(owners.map(async owner => {
    expect(await fake.enrichmentState(ctx(undefined, owner))).toMatchObject({ onboarded: false, signIn: { provider: "google" }, github: { connected: false, login: null } });
    await expect(fake.getMe(ctx(undefined, owner))).rejects.toMatchObject({ status: 409 });
    await fake.saveEnrichmentIdentity(ctx({ ...enrichmentIdentity, name: owner }, owner));
    await fake.uploadCv(ctx({ consent: true, text: owner }, owner));
    expect(await fake.connectGitHub(ctx(undefined, owner))).toMatchObject({ status: "connected", login: "demo-connected" });
  }));
  const states = await Promise.all(owners.map(owner => fake.enrichmentState(ctx(undefined, owner))));
  expect(states.map(s => s.identity?.name)).toEqual(owners);
  expect(states[0].pendingCv?.uploadId).not.toBe(states[1].pendingCv?.uploadId);
  expect(states.every(s => s.signIn.provider === "google")).toBe(true);
  expect(store.profile(DEMO_GOOGLE_NEW).githubLogin).toBeNull();
});

it("provides a deterministic already-linked refusal without another test consuming the fixture", async () => {
  const owner = "u_google_new_refusal";
  await fake.saveEnrichmentIdentity(ctx({ ...enrichmentIdentity, name: "[demo:linked_elsewhere]" }, owner));
  await expect(fake.connectGitHub(ctx(undefined, owner))).rejects.toMatchObject({ status: 409, code: "github_linked_elsewhere" });
  expect((await fake.enrichmentState(ctx(undefined, owner))).github).toEqual({ connected: false, login: null });
});

it("reports recorded extracted-CV truncation without retaining or returning the file body", async () => {
  const cv = routes.uploadCv.response.parse(await fake.uploadCv(ctx({ consent: true, file: new File(["%PDF-1.7 DEMO:LONG private-body"], "long.pdf", { type: "application/pdf" }) })));
  expect(cv).toMatchObject({ characters: 30_000, warnings: ["cv_truncated"] });
  expect(JSON.stringify([...store.get().enrichment.uploads.values()])).not.toContain("private-body");
  expect((await fake.enrichmentState(ctx())).pendingCv).toEqual(cv);
});

it("keeps the pasted profile title neutral after approval exposes selected evidence to matches", async () => {
  const input = enrichmentStart(); input.github.import = false; input.publicProfile = { kind: "text", text: "Private raw input" };
  const job = await ready(input);
  await fake.acceptEnrichment(ctx(acceptance(job), DEMO_USER_A, job.jobId));
  expect(store.get().enrichment.evidence.get(DEMO_USER_A)?.[0]).toMatchObject({ source: "public_profile", title: "Profile text" });
  expect((await fake.enrichmentSources(ctx()))[0].label).toBe("Profile text");
});
/**
 * Contract tests. They run against the fake now; when B's real handlers are
 * ready, add them to `implementations` and the same tests prove the swap
 * is safe.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_USER_A, DEMO_USER_B, sampleAsks } from "@/contracts/fixtures";
import { search } from "@/server/search";
import { routes, type Api, type Ctx, type RouteName } from "@/contracts/routes";
import { fake } from "./handlers";
import { store } from "./store";
import { enrichmentIdentity, enrichmentStart } from "../fixtures/enrichment";
import { SourceUrl } from "../enrichment";

const implementations: { name: string; api: Api; reset: () => void }[] = [
  { name: "fake", api: fake, reset: () => store.reset() },
];

function ctx<N extends RouteName>(userId: string, body?: unknown, params: Record<string, string> = {}, q = ""): Ctx<N> {
  return { userId, params, query: new URLSearchParams(q), body } as Ctx<N>;
}

describe.each(implementations)("$name API", ({ api, reset }) => {
  beforeEach(reset);

  async function readyEnrichment() {
    const body = enrichmentStart();
    const discovery = await api.discoverEnrichment(ctx(DEMO_USER_A, { identity: body.identity, sources: { research: true, publicProfile: true } }));
    routes.discoverEnrichment.response.parse(discovery);
    expect(discovery.research.candidates).toHaveLength(4);
    expect(discovery.publicProfile.candidates).toHaveLength(4);
    const upload = await api.uploadCv(ctx(DEMO_USER_A, { consent: true, text: "Private contact data is not returned or indexed by the fake." }));
    routes.uploadCv.response.parse(upload);
    Object.assign(body, { discoveryId: discovery.discoveryId, authorId: discovery.research.candidates[0].id,
      publicProfile: { kind: "candidate", candidateId: discovery.publicProfile.candidates[0].id }, cvUploadId: upload.uploadId });
    const started = await api.startEnrichment(ctx(DEMO_USER_A, body));
    routes.startEnrichment.response.parse(started);
    expect((await api.startEnrichment(ctx(DEMO_USER_A, body))).jobId).toBe(started.jobId);
    const params = { id: started.jobId };
    expect((await api.getEnrichment(ctx(DEMO_USER_A, undefined, params))).state).toBe("collecting");
    expect((await api.getEnrichment(ctx(DEMO_USER_A, undefined, params))).state).toBe("synthesizing");
    const ready = await api.getEnrichment(ctx(DEMO_USER_A, undefined, params));
    routes.getEnrichment.response.parse(ready);
    expect(ready.state).toBe("ready");
    return { body, ready, params, upload };
  }

  it("imports four fake sources without publishing, then approves only chosen evidence and preserves badge/time edits", async () => {
    const before = await api.getMe(ctx(DEMO_USER_A));
    const { ready, params, upload } = await readyEnrichment();
    expect(await api.getMe(ctx(DEMO_USER_A))).toEqual(before);
    expect(ready.evidence.map(e => e.kind)).toEqual(["repo", "paper", "profile_page", "cv"]);
    expect(JSON.stringify(ready)).not.toContain("Private contact data");
    expect(ready.evidence.find(e => e.kind === "cv")).not.toHaveProperty("url");
    await api.putMe(ctx(DEMO_USER_A, { badgeColour: "lilac", visibility: { country: false, workplace: false, hiring: false } }));
    await api.putAvailability(ctx(DEMO_USER_A, []));
    const accept = { ...ready.draft!, bio: "My reviewed bio.", evidenceIds: ready.evidence.filter(e => e.kind !== "cv").map(e => e.id) };
    const saved = await api.acceptEnrichment(ctx(DEMO_USER_A, accept, params));
    routes.acceptEnrichment.response.parse(saved);
    expect(saved.person).toMatchObject({ bio: accept.bio, badgeColour: "lilac", freeTimes: [], visibility: { country: false, workplace: false, hiring: false } });
    expect((await api.enrichmentSources(ctx(DEMO_USER_A))).reduce((sum, s) => sum + s.evidenceCount, 0)).toBe(3);
    expect((await api.acceptEnrichment(ctx(DEMO_USER_A, accept, params))).person).toEqual(saved.person);
    expect(store.get().enrichment.uploads.get(upload.uploadId)?.removed).toBe(true);
    await expect(api.acceptEnrichment(ctx(DEMO_USER_A, { ...accept, bio: "Different repeat" }, params))).rejects.toMatchObject({ status: 409 });
  });

  it("keeps all-off onboarding manual and discovers nothing for deselected sources", async () => {
    const discovery = await api.discoverEnrichment(ctx(DEMO_USER_A, { identity: enrichmentIdentity, sources: { research: false, publicProfile: false } }));
    expect(discovery.research).toMatchObject({ status: "not_selected", candidates: [] });
    expect(discovery.publicProfile).toMatchObject({ status: "not_selected", candidates: [] });
    const body = enrichmentStart();
    body.permissions = { github: { bio: false, repos: false, organisations: false }, research: false, publicProfile: false, cv: false };
    const job = await api.startEnrichment(ctx(DEMO_USER_A, body));
    expect(await api.getEnrichment(ctx(DEMO_USER_A, undefined, { id: job.jobId }))).toMatchObject({ state: "manual", draft: null, evidence: [] });
  });

  it("rejects stale candidate choices, expired uploads, mismatched consent and reused keys with different input", async () => {
    const body = enrichmentStart();
    const discovery = await api.discoverEnrichment(ctx(DEMO_USER_A, { identity: body.identity, sources: { research: true, publicProfile: true } }));
    body.discoveryId = discovery.discoveryId;
    body.authorId = "not-a-candidate";
    await expect(api.startEnrichment(ctx(DEMO_USER_A, body))).rejects.toMatchObject({ status: 409 });
    body.authorId = discovery.research.candidates[0].id;
    body.identity.name = "Changed identity";
    await expect(api.startEnrichment(ctx(DEMO_USER_A, body))).rejects.toMatchObject({ status: 409 });
    body.identity.name = enrichmentIdentity.name;
    await api.startEnrichment(ctx(DEMO_USER_A, body));
    await expect(api.startEnrichment(ctx(DEMO_USER_A, { ...body, authorId: null }))).rejects.toMatchObject({ status: 409 });
    expect(routes.startEnrichment.body.safeParse({ ...body, permissions: { ...body.permissions, research: false } }).success).toBe(false);
    const upload = await api.uploadCv(ctx(DEMO_USER_A, { consent: true, text: "Bounded CV" }));
    store.get().enrichment.uploads.get(upload.uploadId)!.value.expiresAt = "2000-01-01T00:00:00Z";
    await expect(api.startEnrichment(ctx(DEMO_USER_A, { ...enrichmentStart(), cvUploadId: upload.uploadId }))).rejects.toMatchObject({ status: 409 });
  });

  it("isolates discovery, upload, job, approval and source removal by owner", async () => {
    const { ready, params, upload, body } = await readyEnrichment();
    const attempts = [
      () => api.startEnrichment(ctx(DEMO_USER_B, { ...body, idempotencyKey: crypto.randomUUID() })),
      () => api.startEnrichment(ctx(DEMO_USER_B, { ...enrichmentStart(), cvUploadId: upload.uploadId })),
      () => api.removeCv(ctx(DEMO_USER_B, undefined, { id: upload.uploadId })),
      () => api.getEnrichment(ctx(DEMO_USER_B, undefined, params)),
      () => api.retryEnrichment(ctx(DEMO_USER_B, undefined, params)),
      () => api.acceptEnrichment(ctx(DEMO_USER_B, ready.draft, params)),
      () => api.cancelEnrichment(ctx(DEMO_USER_B, undefined, params)),
    ];
    for (const attempt of attempts) await expect(attempt()).rejects.toMatchObject({ status: 404 });
    await api.acceptEnrichment(ctx(DEMO_USER_A, ready.draft, params));
    const sources = await api.enrichmentSources(ctx(DEMO_USER_A));
    routes.enrichmentSources.response.parse(sources);
    await expect(api.removeEnrichmentSource(ctx(DEMO_USER_B, undefined, { id: sources[0].sourceId }))).rejects.toMatchObject({ status: 404 });
    expect((await api.enrichmentSources(ctx(DEMO_USER_B))).some(s => s.sourceId.startsWith(`${DEMO_USER_A}:`))).toBe(false);
  });

  it("protects bio edits made during collection and refuses unknown evidence", async () => {
    const started = await api.startEnrichment(ctx(DEMO_USER_A, enrichmentStart()));
    await api.putMe(ctx(DEMO_USER_A, { bio: "Newer manual edit" }));
    const params = { id: started.jobId };
    await api.getEnrichment(ctx(DEMO_USER_A, undefined, params));
    await api.getEnrichment(ctx(DEMO_USER_A, undefined, params));
    const ready = await api.getEnrichment(ctx(DEMO_USER_A, undefined, params));
    expect(ready.needsReview).toBe(true);
    await expect(api.acceptEnrichment(ctx(DEMO_USER_A, ready.draft, params))).rejects.toMatchObject({ status: 409 });
    expect((await api.getMe(ctx(DEMO_USER_A))).bio).toBe("Newer manual edit");
    const clean = await readyEnrichment();
    await expect(api.acceptEnrichment(ctx(DEMO_USER_A, { ...clean.ready.draft, evidenceIds: ["foreign-evidence"] }, clean.params))).rejects.toMatchObject({ status: 400 });
  });

  it("cancels unaccepted uploads and jobs, with no late approval or retry", async () => {
    const { ready, params, upload } = await readyEnrichment();
    expect(await api.removeCv(ctx(DEMO_USER_A, undefined, { id: upload.uploadId }))).toEqual({ removed: true });
    expect((await api.cancelEnrichment(ctx(DEMO_USER_A, undefined, params))).state).toBe("cancelled");
    expect((await api.getEnrichment(ctx(DEMO_USER_A, undefined, params))).draft).toBeNull();
    await expect(api.acceptEnrichment(ctx(DEMO_USER_A, ready.draft, params))).rejects.toMatchObject({ status: 409 });
    await expect(api.retryEnrichment(ctx(DEMO_USER_A, undefined, params))).rejects.toMatchObject({ status: 409 });
  });

  it("withdraws one approved source, preserves other evidence and invalidates pending work", async () => {
    const { ready, params } = await readyEnrichment();
    await api.acceptEnrichment(ctx(DEMO_USER_A, ready.draft, params));
    const pending = await api.startEnrichment(ctx(DEMO_USER_A, enrichmentStart()));
    const sources = await api.enrichmentSources(ctx(DEMO_USER_A));
    const cv = sources.find(s => s.source === "cv")!;
    const removed = await api.removeEnrichmentSource(ctx(DEMO_USER_A, undefined, { id: cv.sourceId }));
    routes.removeEnrichmentSource.response.parse(removed);
    expect(removed.reviewBio).toBe(true);
    expect(await api.enrichmentSources(ctx(DEMO_USER_A))).toHaveLength(3);
    expect(store.get().enrichment.evidence.get(DEMO_USER_A)?.some(e => e.source === "cv")).toBe(false);
    expect((await api.getEnrichment(ctx(DEMO_USER_A, undefined, { id: pending.jobId }))).state).toBe("cancelled");
    await api.removeEnrichmentSource(ctx(DEMO_USER_A, undefined, { id: cv.sourceId }));
    expect((await api.getMe(ctx(DEMO_USER_A))).bio).toBe(ready.draft!.bio);
    const newer = await api.startEnrichment(ctx(DEMO_USER_A, enrichmentStart()));
    await api.removeEnrichmentSource(ctx(DEMO_USER_A, undefined, { id: cv.sourceId }));
    expect((await api.getEnrichment(ctx(DEMO_USER_A, undefined, { id: newer.jobId }))).state).toBe("collecting");
    expect((await api.getEnrichment(ctx(DEMO_USER_A, undefined, params))).evidence.some(e => e.source === "cv")).toBe(false);
    await api.putMe(ctx(DEMO_USER_A, { badgeColour: "mint" }));
    const indexed = await search.searchCandidates("recorded", { excludeIds: [] });
    expect(indexed.find(c => c.person.id === DEMO_USER_A)?.highlights).toContain("Demo research evidence");
    expect(indexed.find(c => c.person.id === DEMO_USER_A)?.highlights).not.toContain("Demo cv evidence");
  });

  it.each(["not a url", "http://example.org", "https://user:secret@example.org", "javascript:alert(1)"])(
    "rejects an invalid source link without throwing: %s", url => expect(SourceUrl.safeParse(url).success).toBe(false),
  );

  it("does not claim to import repositories when only GitHub bio is permitted", async () => {
    const body = enrichmentStart(); body.permissions.github = { bio: true, repos: false, organisations: false };
    const job = await api.startEnrichment(ctx(DEMO_USER_A, body));
    const params = { id: job.jobId };
    await api.getEnrichment(ctx(DEMO_USER_A, undefined, params)); await api.getEnrichment(ctx(DEMO_USER_A, undefined, params));
    const ready = await api.getEnrichment(ctx(DEMO_USER_A, undefined, params));
    expect(ready.evidence.every(e => e.kind !== "repo")).toBe(true);
  });

  it("exercises partial failure and retry with a new draft version, without inventing evidence for a failed source", async () => {
    const { ready, params } = await readyEnrichment();
    const job = store.get().enrichment.jobs.get(ready.jobId)!;
    job.value.state = "synthesizing";
    job.value.sources = job.value.sources.map(s => s.source === "research" ? { ...s, status: "failed", reason: "temporarily_unavailable" } : s);
    const partial = await api.getEnrichment(ctx(DEMO_USER_A, undefined, params));
    expect(partial.state).toBe("partial");
    expect(partial.evidence.some(e => e.source === "research")).toBe(false);
    routes.retryEnrichment.response.parse(await api.retryEnrichment(ctx(DEMO_USER_A, undefined, params)));
    await api.getEnrichment(ctx(DEMO_USER_A, undefined, params)); await api.getEnrichment(ctx(DEMO_USER_A, undefined, params));
    const recovered = await api.getEnrichment(ctx(DEMO_USER_A, undefined, params));
    expect(recovered.draft?.version).toBe(2);
    await expect(api.acceptEnrichment(ctx(DEMO_USER_A, ready.draft, params))).rejects.toMatchObject({ status: 409 });
  });

  it("expires a draft, clears its temporary data and prevents retry or approval", async () => {
    const { ready, params, upload } = await readyEnrichment();
    store.get().enrichment.jobs.get(ready.jobId)!.value.expiresAt = "2000-01-01T00:00:00Z";
    expect(await api.getEnrichment(ctx(DEMO_USER_A, undefined, params))).toMatchObject({ state: "failed", draft: null, evidence: [] });
    expect(store.get().enrichment.uploads.get(upload.uploadId)?.removed).toBe(true);
    await expect(api.acceptEnrichment(ctx(DEMO_USER_A, ready.draft, params))).rejects.toMatchObject({ status: 409 });
    await expect(api.retryEnrichment(ctx(DEMO_USER_A, undefined, params))).rejects.toMatchObject({ status: 409 });
  });

  it("returns a structured pending sync after saving, and repairs on identical approval retry", async () => {
    const { ready, params } = await readyEnrichment();
    const ingest = vi.spyOn(search, "ingestPerson").mockRejectedValueOnce(new Error("Private provider details"));
    try {
      const saved = await api.acceptEnrichment(ctx(DEMO_USER_A, ready.draft, params));
      expect(saved).toMatchObject({ person: { bio: ready.draft!.bio }, sync: { status: "pending", retryable: true } });
      expect(JSON.stringify(saved)).not.toContain("Private provider details");
      const repaired = await api.acceptEnrichment(ctx(DEMO_USER_A, ready.draft, params));
      expect(repaired.sync).toMatchObject({ status: "synced", savedRevision: saved.sync.savedRevision });
    } finally { ingest.mockRestore(); }
  });

  it("does not retain pasted professional text in fake jobs and can fail without inventing a draft", async () => {
    const body = { ...enrichmentStart(), publicProfile: { kind: "text", text: "Private pasted professional input" } };
    const started = await api.startEnrichment(ctx(DEMO_USER_A, body));
    const job = store.get().enrichment.jobs.get(started.jobId)!;
    expect(JSON.stringify(job)).not.toContain("Private pasted professional input");
    expect((await api.startEnrichment(ctx(DEMO_USER_A, body))).jobId).toBe(started.jobId);
    job.value.state = "synthesizing";
    job.value.sources = job.value.sources.map(s => s.status === "not_selected" ? s : { ...s, status: "failed", reason: "import_unavailable" });
    expect(await api.getEnrichment(ctx(DEMO_USER_A, undefined, { id: started.jobId }))).toMatchObject({ state: "failed", draft: null, evidence: [] });
  });

  it("hides card fields while retaining owner data and matching results", async () => {
    const { askId } = await api.refine(ctx(DEMO_USER_A, { text: sampleAsks[0].raw }));
    const before = await api.match(ctx(DEMO_USER_A, { askId }));
    const target = before[0].person.id;
    const original = await api.getMe(ctx(target));
    await api.putMe(ctx(target, { workplaceName: "Acme", visibility: { country: false, workplace: false, hiring: false } }));
    const after = await api.match(ctx(DEMO_USER_A, { askId }));
    expect(after.map(card => card.person.id)).toEqual(before.map(card => card.person.id));
    expect(after[0].person).toMatchObject({ workplaceName: null, filters: { country: null, rorId: null, hiring: null } });
    expect(await api.getMe(ctx(target))).toMatchObject({ workplaceName: "Acme", filters: original.filters });
    expect((await search.getPerson(target))?.filters).toEqual(original.filters);
    await api.putMe(ctx(target, { visibility: { country: true, workplace: true, hiring: true } }));
    expect((await api.match(ctx(DEMO_USER_A, { askId })))[0].person).toMatchObject({ workplaceName: "Acme", filters: original.filters });
  });

  it.each([{ visibility: { country: false } }, { visibility: { country: "false", workplace: true, hiring: true } }])(
    "rejects invalid visibility %j", body => expect(routes.putMe.body.safeParse(body).success).toBe(false),
  );

  it("resolves one ask at a time and removes it from reverse search", async () => {
    const first = await api.refine(ctx(DEMO_USER_A, { text: "UniqueLifecycleTopic" }));
    const second = await api.refine(ctx(DEMO_USER_A, { text: "UniqueLifecycleTopic" }));
    const target = { ...await api.getMe(ctx(DEMO_USER_B)), id: "lifecycle-contract-target", bio: "UniqueLifecycleTopic" };
    expect(await search.whoIsLookingFor(target)).toContain(DEMO_USER_A);
    await expect(api.resolve(ctx(DEMO_USER_B, undefined, { id: first.askId }))).rejects.toMatchObject({ status: 404 });
    await api.resolve(ctx(DEMO_USER_A, undefined, { id: first.askId }));
    expect(await search.whoIsLookingFor(target)).toContain(DEMO_USER_A);
    expect(await api.resolve(ctx(DEMO_USER_A, undefined, { id: second.askId }))).toMatchObject({ status: "resolved" });
    await api.resolve(ctx(DEMO_USER_A, undefined, { id: second.askId }));
    expect(await search.whoIsLookingFor(target)).not.toContain(DEMO_USER_A);
  });

  it("saves a workplace name and badge colour, preserves them on unrelated edits and clears the workplace", async () => {
    const body = routes.putMe.body.parse({ workplaceName: "  Acme Robotics  ", badgeColour: "lilac" });
    const saved = await api.putMe(ctx(DEMO_USER_A, body));
    expect(saved).toMatchObject({ workplaceName: "Acme Robotics", badgeColour: "lilac" });
    await api.putMe(ctx(DEMO_USER_A, { bio: "Updated biography" }));
    expect(await api.getMe(ctx(DEMO_USER_A))).toMatchObject({ workplaceName: "Acme Robotics", badgeColour: "lilac" });
    expect(await api.putMe(ctx(DEMO_USER_A, { workplaceName: null }))).toMatchObject({ workplaceName: null, badgeColour: "lilac" });
  });

  it.each([{ workplaceName: " " }, { workplaceName: "x".repeat(201) }, { badgeColour: "neon" }])(
    "rejects invalid profile presentation %j", (body) => {
      expect(routes.putMe.body.safeParse(body).success).toBe(false);
    },
  );

  it("clears a stale workplace label when an older client changes its ROR ID", async () => {
    const me = await api.putMe(ctx(DEMO_USER_A, { workplaceName: "Original workplace" }));
    expect(await api.putMe(ctx(DEMO_USER_A, { filters: { ...me.filters, country: "GB" } }))).toMatchObject({ workplaceName: "Original workplace" });
    expect(await api.putMe(ctx(DEMO_USER_A, { filters: { ...me.filters, rorId: null } }))).toMatchObject({ workplaceName: null });
  });

  it("every response matches the contract", async () => {
    const me = await api.getMe(ctx(DEMO_USER_A));
    expect(routes.getMe.response.parse(me)).toEqual(me);

    expect(routes.searchRor.response.parse(await api.searchRor(ctx(DEMO_USER_A, undefined, {}, "q=grafana")))).toHaveLength(1);
    expect(routes.getAvailability.response.parse(await api.getAvailability(ctx(DEMO_USER_A)))).not.toHaveLength(0);
    routes.lookingForMe.response.parse(await api.lookingForMe(ctx(DEMO_USER_B)));
  });

  it("refines every sample ask to its expected top person", async () => {
    for (const sample of sampleAsks) {
      const { askId, refined } = await api.refine(ctx(DEMO_USER_A, { text: sample.raw }));
      routes.refine.response.parse({ askId, refined });
      const results = await api.match(ctx(DEMO_USER_A, { askId }));
      routes.match.response.parse(results);
      expect(results[0]?.person.id, sample.raw).toBe(sample.expectedTop);
      expect(results[0]?.highlights.length).toBeGreaterThan(0);
      expect(results.every((r) => r.person.id !== DEMO_USER_A)).toBe(true);
    }
  });

  it("marks mutual interest and counts who is looking for you", async () => {
    const { askId } = await api.refine(ctx(DEMO_USER_A, { text: sampleAsks[0].raw }));
    const results = await api.match(ctx(DEMO_USER_A, { askId }));
    expect(results.find((r) => r.person.id === DEMO_USER_B)?.mutual).toBe(true);
    const { count } = await api.lookingForMe(ctx(DEMO_USER_B));
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it("hides rejected people, batch-hides after three, and the soft blocker switches it off", async () => {
    const { askId } = await api.refine(ctx(DEMO_USER_A, { text: "kubernetes scheduling preemption etcd raft argo gitops" }));
    const first = await api.match(ctx(DEMO_USER_A, { askId }));
    expect(first.length).toBeGreaterThanOrEqual(4);

    let r = await api.reject(ctx(DEMO_USER_A, { askId, personId: first[0].person.id, rank: 0 }));
    expect(r.hiddenBelowRank).toBeNull();
    const afterOne = await api.match(ctx(DEMO_USER_A, { askId }));
    expect(afterOne.some((x) => x.person.id === first[0].person.id)).toBe(false);
    // Everyone else keeps their rank, so the rank sent with a later rejection means the same place.
    for (const card of afterOne) {
      const before = first.find((x) => x.person.id === card.person.id);
      if (before) expect(card.rank).toBe(before.rank);
    }

    // A repeat (retry, double tap) is not counted again.
    r = await api.reject(ctx(DEMO_USER_A, { askId, personId: first[0].person.id, rank: 0 }));
    expect(r.rejections).toBe(1);

    await api.reject(ctx(DEMO_USER_A, { askId, personId: first[1].person.id, rank: 1 }));
    r = await api.reject(ctx(DEMO_USER_A, { askId, personId: first[2].person.id, rank: 2 }));
    expect(r.rejections).toBe(3);
    expect(r.hiddenBelowRank).toBe(2);
    // Ranks 0-2 were passed on and everyone ranked below the last of them is hidden: no one is left.
    expect(await api.match(ctx(DEMO_USER_A, { askId }))).toEqual([]);

    await api.setSoftBlocker(ctx(DEMO_USER_A, { askId, enabled: false }));
    const off = await api.match(ctx(DEMO_USER_A, { askId }));
    expect(off.map((x) => [x.person.id, x.rank])).toEqual(first.slice(0, 2).map((x) => [x.person.id, x.rank]));
  });

  it("sends one request per person per ask and leaves them out of later matches", async () => {
    const { askId } = await api.refine(ctx(DEMO_USER_A, { text: "kubernetes scheduling preemption etcd raft argo gitops" }));
    const first = await api.match(ctx(DEMO_USER_A, { askId }));
    expect(first.length).toBeGreaterThanOrEqual(2);
    const to = first[0].person.id;

    const sent = await api.sendRequest(ctx(DEMO_USER_A, { askId, toPersonId: to }));
    expect(await api.sendRequest(ctx(DEMO_USER_A, { askId, toPersonId: to }))).toEqual(sent);
    expect((await api.inbox(ctx(to))).filter((x) => x.askId === askId)).toHaveLength(1);

    const after = await api.match(ctx(DEMO_USER_A, { askId }));
    expect(after.some((x) => x.person.id === to)).toBe(false);
    expect(after.find((x) => x.person.id === first[1].person.id)?.rank).toBe(first[1].rank);
  });

  it("shows each side the other person's badge, and lets the asker follow the reply and booking", async () => {
    const { askId, refined } = await api.refine(ctx(DEMO_USER_A, { text: sampleAsks[0].raw }));
    const asker = await api.putMe(ctx(DEMO_USER_A, { visibility: { country: false, workplace: true, hiring: true } }));
    const sent = await api.sendRequest(ctx(DEMO_USER_A, { askId, toPersonId: DEMO_USER_B }));

    // The receiver sees who is asking (with the asker's hidden sections left out) and what kind of ask it is.
    const [received] = routes.inbox.response.parse(await api.inbox(ctx(DEMO_USER_B)));
    expect(received).toMatchObject({ id: sent.id, type: refined.type });
    expect(received.person).toMatchObject({ id: DEMO_USER_A, name: asker.name, filters: { country: null } });
    expect(received.person).not.toHaveProperty("visibility");

    // The asker sees the receiver's badge, then their answer.
    let [mine] = routes.sentRequests.response.parse(await api.sentRequests(ctx(DEMO_USER_A)));
    expect(mine).toMatchObject({ id: sent.id, status: "sent", type: refined.type, person: { id: DEMO_USER_B } });
    await api.respond(ctx(DEMO_USER_B, { action: "reply", reply: "Use priority classes." }, { id: sent.id }));
    [mine] = await api.sentRequests(ctx(DEMO_USER_A));
    expect(mine).toMatchObject({ status: "answered", reply: "Use priority classes." });
    expect(await api.sentRequests(ctx(DEMO_USER_B))).toEqual([]);
  });

  it("reads back the caller's own ask, including its soft-blocker setting", async () => {
    const { askId, refined } = await api.refine(ctx(DEMO_USER_A, { text: sampleAsks[0].raw }));
    expect(routes.getAsk.response.parse(await api.getAsk(ctx(DEMO_USER_A, undefined, { id: askId }))))
      .toMatchObject({ id: askId, userId: DEMO_USER_A, refined, status: "open", softBlocker: true });
    await api.setSoftBlocker(ctx(DEMO_USER_A, { askId, enabled: false }));
    expect(await api.getAsk(ctx(DEMO_USER_A, undefined, { id: askId }))).toMatchObject({ softBlocker: false });
    await expect(api.getAsk(ctx(DEMO_USER_B, undefined, { id: askId }))).rejects.toMatchObject({ status: 404 });
  });

  it("runs the whole flow: send, receive, accept, slot, book, resolve", async () => {
    const { askId } = await api.refine(ctx(DEMO_USER_A, { text: sampleAsks[0].raw }));
    const sent = await api.sendRequest(ctx(DEMO_USER_A, { askId, toPersonId: DEMO_USER_B }));
    routes.sendRequest.response.parse(sent);
    expect(sent.question).toContain("preemption");

    const inbox = await api.inbox(ctx(DEMO_USER_B));
    expect(inbox.map((r) => r.id)).toContain(sent.id);

    await expect(api.respond(ctx(DEMO_USER_A, { action: "accept" }, { id: sent.id }))).rejects.toMatchObject({ status: 403 });
    const accepted = await api.respond(ctx(DEMO_USER_B, { action: "accept" }, { id: sent.id }));
    expect(accepted.status).toBe("accepted");

    const slots = await api.slots(ctx(DEMO_USER_A, undefined, { id: sent.id }));
    routes.slots.response.parse(slots);
    for (const s of slots) expect(Date.parse(s.start) - Date.now()).toBeGreaterThanOrEqual(60 * 60_000 - 1000);

    if (slots.length) {
      const booked = await api.schedule(ctx(DEMO_USER_A, { slot: slots[0] }, { id: sent.id }));
      expect(booked.status).toBe("scheduled");
      expect(booked.slot).toEqual(slots[0]);
    }

    const resolved = await api.resolve(ctx(DEMO_USER_A, undefined, { id: askId }));
    expect(resolved.status).toBe("resolved");
  });

  it("lets a receiver answer in a short reply without a meeting", async () => {
    const { askId } = await api.refine(ctx(DEMO_USER_A, { text: sampleAsks[2].raw }));
    const sent = await api.sendRequest(ctx(DEMO_USER_A, { askId, toPersonId: "p_002" }));
    const answered = await api.respond(ctx("p_002", { action: "reply", reply: "Compaction only trims below the snapshot index." }, { id: sent.id }));
    expect(answered.status).toBe("answered");
    expect(answered.reply).toMatch(/snapshot/);
  });
});

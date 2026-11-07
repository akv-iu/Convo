import type { z } from "zod";
import { createHash } from "node:crypto";
import * as fixtures from "../fixtures";
import type { Api, RouteBody, RouteResponse } from "../routes";
import { EnrichmentSource, type EnrichmentJob, type SavedEnrichmentSource } from "../enrichment";
import { search } from "@/server/search";
import { store } from "./store";

type Job = { owner: string; input: RouteBody<"startEnrichment">; value: EnrichmentJob; baseTextRevision: number; draftVersion: number;
  inputFingerprint: string; accepted?: { input: string; revision: number }; };
export interface FakeEnrichmentState {
  discoveries: Map<string, { owner: string; input: RouteBody<"discoverEnrichment">; value: RouteResponse<"discoverEnrichment"> }>;
  uploads: Map<string, { owner: string; value: RouteResponse<"uploadCv">; removed: boolean }>;
  jobs: Map<string, Job>;
  sources: Map<string, { owner: string; value: z.infer<typeof SavedEnrichmentSource>; removed: boolean }>;
  evidence: Map<string, EnrichmentJob["evidence"]>;
  versions: Map<string, { revision: number; text: number; generation: number }>;
}
export function freshEnrichment(): FakeEnrichmentState {
  const evidence = new Map<string, EnrichmentJob["evidence"]>();
  for (const doc of fixtures.evidence) {
    evidence.set(doc.personId, [...(evidence.get(doc.personId) ?? []), { ...doc, source: "github", sourceId: `${doc.personId}:github`,
      externalId: doc.id, retrievedAt: "2026-11-05T00:00:00Z" }]);
  }
  const sources: FakeEnrichmentState["sources"] = new Map();
  for (const [owner, docs] of evidence) {
    const sourceId = `${owner}:github`;
    sources.set(sourceId, { owner, removed: false, value: { sourceId, source: "github", title: "Saved demo GitHub evidence",
      url: docs[0]?.url ?? null, evidenceCount: docs.length } });
  }
  return { discoveries: new Map(), uploads: new Map(), jobs: new Map(), sources, evidence, versions: new Map() };
}
const state = () => store.get().enrichment;
const expires = () => new Date(Date.now() + 86_400_000).toISOString();
function fail(message: string, status = 409): never { throw Object.assign(new Error(message), { status }); }
function owned<T extends { owner: string }>(value: T | undefined, userId: string): T {
  if (!value || value.owner !== userId) fail("Not found.", 404);
  return value;
}
function versions(userId: string) {
  let value = state().versions.get(userId);
  if (!value) { value = { revision: 0, text: 0, generation: 0 }; state().versions.set(userId, value); }
  return value;
}
export function noteProfileChange(userId: string, textChanged = false) {
  const value = versions(userId);
  value.revision++;
  if (textChanged) value.text++;
}
function jobFor(userId: string, id: string): Job {
  const job = owned(state().jobs.get(id), userId);
  if (!["accepted", "cancelled"].includes(job.value.state) && Date.parse(job.value.expiresAt) <= Date.now()) {
    discard(job);
    job.value.state = "failed";
    job.value.sources = job.value.sources.map(s => s.status === "not_selected" ? s : { ...s, status: "failed", reason: "expired_input" });
  }
  job.value.textRevision = versions(userId).text;
  job.value.needsReview = job.value.state !== "accepted" && job.value.draft !== null && job.value.draft.baseTextRevision !== job.value.textRevision;
  return job;
}
function selected(input: RouteBody<"startEnrichment">, source: EnrichmentSource): boolean {
  if (source === "github") return Object.values(input.permissions.github).some(Boolean);
  if (source === "research") return input.permissions.research && input.authorId !== null;
  if (source === "public_profile") return input.permissions.publicProfile && input.publicProfile !== null;
  return input.permissions.cv && input.cvUploadId !== null;
}
function discard(job: Job) {
  job.value.state = "cancelled";
  job.value.draft = null;
  job.value.evidence = [];
  if (job.input.cvUploadId) {
    const upload = state().uploads.get(job.input.cvUploadId);
    if (upload) upload.removed = true;
  }
}
async function sync(userId: string, revision: number) {
  try {
    await search.ingestPerson(store.person(userId), state().evidence.get(userId) ?? []);
    return { status: "synced" as const, retryable: false, savedRevision: revision };
  } catch {
    return { status: "pending" as const, retryable: true, savedRevision: revision };
  }
}

type Names = "discoverEnrichment" | "uploadCv" | "removeCv" | "startEnrichment" | "getEnrichment" |
  "retryEnrichment" | "acceptEnrichment" | "cancelEnrichment" | "enrichmentSources" | "removeEnrichmentSource";
export const enrichmentFake: Pick<Api, Names> = {
  async discoverEnrichment({ userId, body }) {
    store.person(userId);
    const discoveryId = store.nextId("discovery");
    const value: RouteResponse<"discoverEnrichment"> = {
      discoveryId, expiresAt: expires(),
      research: { status: body.sources.research ? "ok" : "not_selected", reason: body.sources.research ? null : "not_selected", retryAfterSeconds: null,
        candidates: body.sources.research ? [0, 1, 2, 3].map(n => ({
          id: `${discoveryId}:author:${n}`, title: `${body.identity.name} (demo ${n + 1})`,
          url: `https://openalex.org/A${100 + n}`, domain: "openalex.org", snippet: "Synthetic author candidate; confirm the right identity.",
          orcid: null, affiliations: [body.identity.workplaceName ?? "Demo institution"], samplePapers: ["A recorded research example"],
        })) : [] },
      publicProfile: { status: body.sources.publicProfile ? "ok" : "not_selected", reason: body.sources.publicProfile ? null : "not_selected", retryAfterSeconds: null,
        candidates: body.sources.publicProfile ? [0, 1, 2, 3].map(n => ({
          id: `${discoveryId}:page:${n}`, title: `${body.identity.name} — demo professional profile ${n + 1}`,
          url: `https://example.org/people/demo-${n}`, domain: "example.org", snippet: "Synthetic preview. Opening a link does not select it.",
        })) : [] },
    };
    state().discoveries.set(discoveryId, { owner: userId, input: structuredClone(body), value });
    return structuredClone(value);
  },
  async uploadCv({ userId, body }) {
    store.person(userId);
    const value = { uploadId: store.nextId("cv"), filename: "file" in body ? body.file.name : "Pasted CV text",
      extractedCharacters: "text" in body ? body.text.length : 120, warnings: [], expiresAt: expires() };
    // Fake mode stages metadata only: no file parsing or real CV text retention.
    state().uploads.set(value.uploadId, { owner: userId, value, removed: false });
    return value;
  },
  async removeCv({ userId, params }) {
    const upload = owned(state().uploads.get(params.id), userId);
    upload.removed = true;
    for (const job of state().jobs.values()) {
      if (job.owner === userId && job.input.cvUploadId === params.id && job.value.state !== "accepted") discard(job);
    }
    return { removed: true };
  },
  async startEnrichment({ userId, body }) {
    store.person(userId);
    const inputFingerprint = createHash("sha256").update(JSON.stringify(body)).digest("hex");
    const previous = [...state().jobs.values()].find(job => job.owner === userId && job.input.idempotencyKey === body.idempotencyKey);
    if (previous) {
      if (previous.inputFingerprint !== inputFingerprint) fail("Idempotency key already used with different choices.");
      return structuredClone(previous.value);
    }
    const discovery = body.discoveryId ? owned(state().discoveries.get(body.discoveryId), userId) : undefined;
    if (discovery && (Date.parse(discovery.value.expiresAt) <= Date.now() || JSON.stringify(discovery.input.identity) !== JSON.stringify(body.identity))) fail("Discovery expired or identity changed.");
    if (body.authorId && !discovery?.value.research.candidates.some(c => c.id === body.authorId)) fail("Unknown research candidate.");
    if (body.publicProfile?.kind === "candidate") {
      const candidateId = body.publicProfile.candidateId;
      if (!discovery?.value.publicProfile.candidates.some(c => c.id === candidateId)) fail("Unknown public profile candidate.");
    }
    if (body.cvUploadId) {
      const upload = owned(state().uploads.get(body.cvUploadId), userId);
      if (upload.removed || Date.parse(upload.value.expiresAt) <= Date.now()) fail("CV input expired or removed.");
    }
    const current = versions(userId);
    for (const old of state().jobs.values()) {
      if (old.owner === userId && !["accepted", "cancelled"].includes(old.value.state)) {
        // A new confirmed selection invalidates old work, without deleting a reused upload.
        old.value.state = "cancelled"; old.value.draft = null; old.value.evidence = [];
      }
    }
    current.generation++;
    const jobId = store.nextId("enrichment");
    const sources = EnrichmentSource.options.map(source => ({ source, sourceId: `${userId}:${source}`,
      status: selected(body, source) ? "queued" as const : "not_selected" as const,
      reason: selected(body, source) ? null : "not_selected" as const, retryAfterSeconds: null }));
    const value: EnrichmentJob = { jobId, state: sources.some(s => s.status === "queued") ? "queued" : "manual",
      sources, selectionGeneration: current.generation, textRevision: current.text, needsReview: false,
      draft: null, evidence: [], expiresAt: expires() };
    const input = structuredClone(body);
    if (input.publicProfile?.kind === "text") input.publicProfile.text = "Recorded pasted input";
    state().jobs.set(jobId, { owner: userId, input, inputFingerprint, value, baseTextRevision: current.text, draftVersion: 1 });
    return structuredClone(value);
  },
  async getEnrichment({ userId, params }) {
    const job = jobFor(userId, params.id);
    const value = job.value;
    // Deterministic polling exercises progress without timers or external calls.
    if (value.state === "queued") value.state = "collecting";
    else if (value.state === "collecting") value.state = "synthesizing";
    else if (value.state === "synthesizing") {
      const evidence = value.sources.filter(s => ["queued", "collecting", "complete"].includes(s.status)).map(s => ({
        id: `${value.jobId}:${s.source}`, personId: userId, sourceId: s.sourceId, source: s.source,
        kind: s.source === "github" ? (job.input.permissions.github.repos ? "repo" as const : "profile_page" as const)
          : ({ research: "paper", public_profile: "profile_page", cv: "cv" } as const)[s.source],
        title: `Demo ${s.source} evidence`, text: "Recorded professional work on reliable systems.", externalId: "recorded-demo",
        ...(s.source === "cv" ? {} : { url: "https://example.org/recorded-evidence" }), retrievedAt: new Date().toISOString(),
      }));
      value.evidence = evidence;
      if (evidence.length === 0) { value.state = "failed"; value.draft = null; return structuredClone(value); }
      value.draft = { version: job.draftVersion, baseTextRevision: job.baseTextRevision, bio: "Works on reliable systems. Enjoys sharing practical experience.", expertise: ["Reliable systems"], evidenceIds: evidence.map(e => e.id) };
      value.sources = value.sources.map(s => ["queued", "collecting"].includes(s.status) ? { ...s, status: "complete" } : s);
      value.state = value.sources.some(s => s.status === "failed") ? "partial" : "ready";
      value.needsReview = job.baseTextRevision !== value.textRevision;
    }
    return structuredClone(value);
  },
  async retryEnrichment({ userId, params }) {
    const job = jobFor(userId, params.id);
    if (!["failed", "stalled", "partial"].includes(job.value.state) || Date.parse(job.value.expiresAt) <= Date.now()) fail("This job cannot be retried.");
    job.baseTextRevision = versions(userId).text; job.draftVersion++;
    job.value.sources = job.value.sources.map(s => s.status === "failed" ? { ...s, status: "queued", reason: null, retryAfterSeconds: null } : s);
    job.value.state = "queued"; job.value.draft = null; job.value.evidence = [];
    return structuredClone(job.value);
  },
  async acceptEnrichment({ userId, params, body }) {
    const job = jobFor(userId, params.id);
    if (job.accepted) {
      if (job.accepted.input !== JSON.stringify(body)) fail("Draft already accepted with different edits.");
      return { person: structuredClone(store.person(userId)), sync: await sync(userId, versions(userId).revision) };
    }
    if (!["ready", "partial"].includes(job.value.state) || !job.value.draft ||
        Date.parse(job.value.expiresAt) <= Date.now() || job.value.selectionGeneration !== versions(userId).generation ||
        body.version !== job.value.draft.version || body.baseTextRevision !== versions(userId).text ||
        body.baseTextRevision !== job.value.draft.baseTextRevision) fail("Draft changed; review it again.");
    if (body.evidenceIds.some(id => !job.value.evidence.some(e => e.id === id)) || new Set(body.evidenceIds).size !== body.evidenceIds.length) fail("Unknown or duplicate evidence.", 400);
    const accepted = job.value.evidence.filter(e => body.evidenceIds.includes(e.id));
    const existing = state().evidence.get(userId) ?? [];
    const replaced = new Set(job.value.sources.filter(s => s.status === "complete").map(s => s.source));
    const complete = [...existing.filter(e => !replaced.has(e.source)), ...accepted];
    state().evidence.set(userId, complete);
    for (const source of job.value.sources.filter(s => replaced.has(s.source))) {
      const evidence = complete.filter(e => e.source === source.source);
      state().sources.set(source.sourceId, { owner: userId, removed: false, value: { sourceId: source.sourceId, source: source.source,
        title: evidence[0]?.title ?? source.source, url: evidence[0]?.url ?? null, evidenceCount: evidence.length } });
    }
    const person = { ...store.person(userId), bio: body.bio, expertise: body.expertise };
    store.get().people.set(userId, person);
    noteProfileChange(userId, true);
    job.accepted = { input: JSON.stringify(body), revision: versions(userId).revision };
    job.value.state = "accepted";
    job.value.needsReview = false;
    if (job.input.cvUploadId) state().uploads.get(job.input.cvUploadId)!.removed = true;
    return { person: structuredClone(person), sync: await sync(userId, versions(userId).revision) };
  },
  async cancelEnrichment({ userId, params }) {
    const job = jobFor(userId, params.id);
    if (job.value.state === "accepted") fail("Use source removal for an accepted profile.");
    discard(job);
    return structuredClone(job.value);
  },
  async enrichmentSources({ userId }) {
    return [...state().sources.values()].filter(s => s.owner === userId && !s.removed).map(s => structuredClone(s.value));
  },
  async removeEnrichmentSource({ userId, params }) {
    const source = owned(state().sources.get(params.id), userId);
    if (source.removed) return { removed: true, reviewBio: true, sync: await sync(userId, versions(userId).revision) };
    source.removed = true;
    versions(userId).generation++;
    for (const job of state().jobs.values()) {
      if (job.owner !== userId) continue;
      if (job.value.state !== "accepted") discard(job);
      else {
        job.value.evidence = job.value.evidence.filter(e => e.sourceId !== params.id);
        job.value.draft = null;
      }
    }
    state().evidence.set(userId, (state().evidence.get(userId) ?? []).filter(e => e.sourceId !== params.id));
    noteProfileChange(userId);
    return { removed: true, reviewBio: true, sync: await sync(userId, versions(userId).revision) };
  },
};

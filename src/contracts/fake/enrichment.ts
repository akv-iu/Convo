import { createHash } from "node:crypto";
import * as fixtures from "../fixtures";
import type { Api, RouteBody, RouteResponse } from "../routes";
import { EnrichmentSource, type EnrichmentJob, type EnrichmentErrorCode } from "../enrichment";
import { search } from "@/server/search";
import { store } from "./store";

type Job = {
  owner: string; input: RouteBody<"startEnrichment">; fingerprint: string; value: EnrichmentJob;
  baseTextVersion: number; draftVersion: number; accepted?: string;
};
export interface FakeEnrichmentState {
  discoveries: Map<string, { owner: string; input: RouteBody<"discoverEnrichment">; value: RouteResponse<"discoverEnrichment"> }>;
  uploads: Map<string, { owner: string; value: RouteResponse<"uploadCv">; removed: boolean }>;
  jobs: Map<string, Job>;
  sources: Map<string, { owner: string; value: RouteResponse<"enrichmentSources">[number]; removed: boolean }>;
  evidence: Map<string, NonNullable<EnrichmentJob["draft"]>["evidence"]>;
  versions: Map<string, { revision: number; text: number; generation: number }>;
  identities: Map<string, RouteBody<"startEnrichment">["identity"]>;
  connections: Map<string, { accountId: string; login: string }>;
}
export function freshEnrichment(): FakeEnrichmentState {
  return {
    discoveries: new Map(), uploads: new Map(), jobs: new Map(), sources: new Map(), evidence: new Map(),
    versions: new Map(), identities: new Map(), connections: new Map(),
  };
}
const state = () => store.get().enrichment;
const expiry = () => new Date(Date.now() + 86_400_000).toISOString();
const fingerprint = (input: unknown) => createHash("sha256").update(JSON.stringify(input ?? null, (_key, value) =>
  value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value)).digest("hex");
function fail(code: EnrichmentErrorCode, status = 409, retryAfterSeconds?: number): never {
  throw Object.assign(new Error("Profile enrichment could not complete."), { code, status, retryAfterSeconds });
}
function owned<T extends { owner: string }>(value: T | undefined, userId: string): T {
  if (!value || value.owner !== userId) fail("not_found", 404);
  return value;
}
function versions(userId: string) {
  let value = state().versions.get(userId);
  if (!value) { value = { revision: 0, text: 0, generation: 0 }; state().versions.set(userId, value); }
  return value;
}
export function noteProfileChange(userId: string, textChanged = false) {
  versions(userId).revision++;
  if (textChanged) versions(userId).text++;
}
function connection(userId: string) {
  return state().connections.get(userId) ?? (store.profile(userId).githubLogin
    ? { accountId: userId, login: store.profile(userId).githubLogin! } : null);
}
function discard(job: Job, terminal: "cancelled" | "superseded" = "cancelled", keepUpload?: string) {
  job.value.state = terminal; job.value.phase = "done"; job.value.draft = null;
  if (job.input.cv && job.input.cv.uploadId !== keepUpload) {
    const upload = state().uploads.get(job.input.cv.uploadId);
    if (upload) upload.removed = true;
  }
}
function jobFor(userId: string, id: string) {
  const job = owned(state().jobs.get(id), userId);
  if (!["accepted", "cancelled", "superseded", "manual"].includes(job.value.state) && Date.parse(job.value.expiresAt) <= Date.now()) {
    discard(job); job.value.state = "failed";
    job.value.sources = job.value.sources.map(s => s.status === "not_selected" ? s : { ...s, status: "failed", reason: s.source === "cv" ? "cv_expired" : "unknown" });
  }
  if (job.value.draft) job.value.draft.needsReview = job.value.state !== "accepted" && job.baseTextVersion !== versions(userId).text;
  return job;
}
async function sync(userId: string) {
  const revision = versions(userId).revision;
  if (store.get().pendingPeople.has(userId)) return { status: "not_onboarded" as const, retryable: false, savedRevision: revision };
  try {
    const evidence = state().evidence.get(userId);
    await search.ingestPerson(store.person(userId), evidence?.map(e => ({ ...e, text: e.excerpt })));
    return { status: "confirmed" as const, retryable: false, savedRevision: revision };
  } catch { return { status: "pending" as const, retryable: true, savedRevision: revision }; }
}
function identityInput(identity: RouteBody<"startEnrichment">["identity"], source: "research" | "public_profile") {
  const { name, workplaceName, rorId, orcid } = identity;
  return { name, workplaceName, rorId, orcid, source };
}
function chosen(userId: string, selection: { discoveryId: string; candidateId: string }, source: "research" | "public_profile", identity: RouteBody<"startEnrichment">["identity"]) {
  const discovery = owned(state().discoveries.get(selection.discoveryId), userId);
  if (Date.parse(discovery.value.expiresAt) <= Date.now() ||
      fingerprint(discovery.input) !== fingerprint(identityInput(identity, source))) fail("selection_stale");
  const candidate = discovery.value.candidates.find(c => c.id === selection.candidateId);
  if (!candidate || discovery.value.source !== source) fail("selection_stale");
  return { label: "name" in candidate ? candidate.name : candidate.title, url: candidate.url };
}
function selectedSources(userId: string, input: RouteBody<"startEnrichment">): EnrichmentJob["sources"] {
  const github = connection(userId);
  if (input.github.import && !github) fail("github_not_connected");
  const research = input.research && !("skip" in input.research) ? chosen(userId, input.research, "research", input.identity) : null;
  const page = input.publicProfile;
  const publicProfile = !page || "skip" in page ? null : "candidateId" in page ? chosen(userId, page, "public_profile", input.identity)
    : "url" in page ? { label: "Public profile", url: page.url } : { label: "Text you pasted" };
  let cv: { label: string; filename: string | null } | null = null;
  if (input.cv) {
    const upload = owned(state().uploads.get(input.cv.uploadId), userId);
    if (upload.removed || Date.parse(upload.value.expiresAt) <= Date.now()) fail("cv_expired");
    cv = { label: upload.value.filename ?? "Pasted CV text", filename: upload.value.filename };
  }
  const selections = { github: input.github.import ? { label: "GitHub", url: "https://github.com/" + github!.login } : null, research, public_profile: publicProfile, cv };
  return EnrichmentSource.options.map(source => ({
    source, sourceId: userId + ":" + source, selection: selections[source],
    status: selections[source] ? "waiting" : "not_selected", items: 0,
  }));
}
function finish(job: Job) {
  const value = job.value;
  const scenario = job.input.identity.name;
  const failure = scenario.includes("[demo:partial]") || scenario.includes("[demo:failed]");
  const first = value.sources.find(s => s.status === "running");
  value.sources = value.sources.map(s => s.status !== "running" ? s : scenario.includes("[demo:empty]")
    ? { ...s, status: "empty", reason: s.source === "github" ? "github_nothing_public" : s.source === "research" ? "research_no_match" : "unknown" }
    : (scenario.includes("[demo:failed]") || (failure && s === first))
    ? { ...s, status: "failed", reason: "provider_down", retryAfterSeconds: 30 }
    : scenario.includes("[demo:reconnect]") && s.source === "github"
      ? { ...s, status: "failed", reason: "github_reconnect" }
      : { ...s, status: "done", items: 1, ...(s.source === "github" ? { github: { bio: job.input.github.bio, repos: job.input.github.repos ? 1 : 0, orgs: job.input.github.orgs ? 1 : 0 } } : {}) });
  const evidence = value.sources.filter(s => s.status === "done").map(s => {
    const kind = s.source === "github" ? (job.input.github.repos ? "repo" as const : "profile_page" as const)
      : ({ research: "paper", public_profile: "profile_page", cv: "cv" } as const)[s.source];
    return {
      id: job.owner + ":" + kind + ":" + value.jobId + "-" + s.source, personId: job.owner, sourceId: s.sourceId,
      source: s.source, kind, title: s.source === "research" ? "Recorded research example" : s.source === "cv" ? "CV excerpt" : s.selection?.label ?? "Recorded evidence",
      excerpt: "Recorded professional work on reliable systems.",
      ...(s.source === "research" ? { url: "https://openalex.org/W5000000100" }
        : s.selection?.url ? { url: s.selection.url } : {}),
      retrievedAt: new Date().toISOString(),
    };
  });
  value.phase = "done";
  value.state = value.sources.some(s => s.status === "failed") ? (evidence.length ? "partial" : "failed") : evidence.length ? "ready" : "manual";
  value.draft = evidence.length ? {
    draftVersion: job.draftVersion, baseTextVersion: job.baseTextVersion,
    bio: "Works on reliable systems. Enjoys sharing practical experience.",
    bioEvidenceIds: evidence.map(e => e.id), expertise: [{ label: "Reliable systems", evidenceIds: evidence.map(e => e.id) }],
    evidence, needsReview: job.baseTextVersion !== versions(job.owner).text,
  } : null;
}
export type EnrichmentRoute = "enrichmentState" | "saveEnrichmentIdentity" | "connectGitHub" | "discoverEnrichment" | "uploadCv" | "removeCv" |
  "startEnrichment" | "getEnrichment" | "retryEnrichment" | "acceptEnrichment" | "cancelEnrichment" |
  "enrichmentSources" | "removeEnrichmentSource";
export const enrichmentFake: Pick<Api, EnrichmentRoute> = {
  async enrichmentState({ userId }) {
    const profile = store.profile(userId);
    const jobs = [...state().jobs.values()].filter(j => j.owner === userId);
    const latest = jobs.at(-1);
    const upload = [...state().uploads.values()].find(u => u.owner === userId && !u.removed && Date.parse(u.value.expiresAt) > Date.now());
    const github = connection(userId);
    return {
      signIn: { provider: userId === fixtures.DEMO_GOOGLE_NEW || userId === fixtures.DEMO_RESEARCHER ? "google" : "github" },
      github: { connected: github !== null, login: github?.login ?? null }, onboarded: profile.filters !== null,
      identity: state().identities.get(userId) ?? null,
      job: latest ? { jobId: latest.value.jobId, state: jobFor(userId, latest.value.jobId).value.state } : null,
      pendingCv: upload ? structuredClone(upload.value) : null,
    };
  },
  async connectGitHub({ userId }) {
    if (state().identities.get(userId)?.name.includes("[demo:connect_cancelled]")) fail("github_connect_cancelled");
    const existing = connection(userId);
    if (existing) return { status: "connected", login: existing.login };
    const recorded = fixtures.DEMO_GITHUB_CONNECTION;
    if ([...state().connections].some(([owner, account]) => owner !== userId && account.accountId === recorded.accountId)) fail("github_linked_elsewhere");
    state().connections.set(userId, recorded);
    store.profile(userId).githubLogin = recorded.login;
    return { status: "connected", login: recorded.login };
  },
  async saveEnrichmentIdentity({ userId, body }) {
    store.profile(userId);
    if (fingerprint(state().identities.get(userId)) !== fingerprint(body)) {
      versions(userId).generation++;
      for (const job of state().jobs.values()) if (job.owner === userId && !["accepted", "cancelled", "superseded"].includes(job.value.state)) discard(job, "superseded");
    }
    state().identities.set(userId, structuredClone(body));
    return enrichmentFake.enrichmentState({ userId, body: undefined, params: {}, query: new URLSearchParams() });
  },
  async discoverEnrichment({ userId, body }) {
    store.profile(userId);
    const discoveryId = store.nextId("discovery");
    const base = { discoveryId, expiresAt: expiry() };
    let value: RouteResponse<"discoverEnrichment">;
    if (body.name.includes("[demo:no_matches]")) value = { ...base, source: body.source, status: "no_matches", candidates: [] };
    else if (body.name.includes("[demo:unavailable]")) value = { ...base, source: body.source, status: "unavailable", reason: "provider_down", retryAfterSeconds: 30, candidates: [] };
    else if (body.source === "research") value = { ...base, source: "research", status: "ok", candidates: [0,1,2,3].map(n => ({
      id: discoveryId + ":author:" + n, name: body.name + " (demo " + (n + 1) + ")", url: "https://openalex.org/A" + (5000000100 + n),
      orcid: null, affiliations: [{ name: body.workplaceName ?? "Recorded institution", years: [2024,2025] }],
      worksCount: 10, samplePapers: [{ title: "Recorded research example", year: 2025, url: "https://openalex.org/W5000000100" }],
    })) };
    else value = { ...base, source: "public_profile", status: "ok", candidates: [0,1,2,3].map(n => ({
      id: discoveryId + ":page:" + n, title: body.name + " - demo profile " + (n + 1),
      url: "https://example.org/people/demo-" + n, domain: "example.org", snippet: "Recorded candidate; opening a link does not select it.",
    })) };
    state().discoveries.set(discoveryId, { owner: userId, input: structuredClone(body), value });
    return structuredClone(value);
  },
  async uploadCv({ userId, body }) {
    store.profile(userId);
    if ("file" in body) {
      const bytes = Buffer.from(await body.file.arrayBuffer());
      const text = bytes.toString("latin1");
      const pdf = text.startsWith("%PDF-");
      const docx = bytes.subarray(0,4).equals(Buffer.from([0x50,0x4b,3,4])) && text.includes("word/document.xml") && text.includes("[Content_Types].xml");
      if (!pdf && !docx) fail("cv_unsupported", 415);
      if (pdf && text.includes("/Encrypt")) fail("cv_encrypted", 422);
      if (text.includes("DEMO:UNREADABLE") || text.includes("DEMO:SCANNED")) fail("cv_unreadable", 422);
    }
    for (const old of state().uploads.values()) if (old.owner === userId && !old.removed) {
      old.removed = true;
      for (const job of state().jobs.values()) if (job.owner === userId && job.input.cv?.uploadId === old.value.uploadId && job.value.state !== "accepted") discard(job);
    }
    const value = { uploadId: store.nextId("cv"), filename: "file" in body ? body.file.name : null,
      characters: "text" in body ? body.text.length : 120, warnings: [], expiresAt: expiry() };
    // Only signatures/recorded outcomes: no extraction or private input retention in the fake.
    state().uploads.set(value.uploadId, { owner: userId, value, removed: false });
    return value;
  },
  async removeCv({ userId, params }) {
    const upload = owned(state().uploads.get(params.id), userId);
    if (!upload.removed) {
      upload.removed = true;
      for (const job of state().jobs.values()) if (job.owner === userId && job.input.cv?.uploadId === params.id && job.value.state !== "accepted") discard(job);
    }
    return { removed: true };
  },
  async startEnrichment({ userId, body }) {
    store.profile(userId);
    const digest = fingerprint(body);
    const previous = [...state().jobs.values()].find(j => j.owner === userId && j.input.idempotencyKey === body.idempotencyKey);
    if (previous) {
      if (previous.fingerprint !== digest) fail("idempotency_conflict");
      return structuredClone(jobFor(userId, previous.value.jobId).value);
    }
    const sources = selectedSources(userId, body);
    for (const old of state().jobs.values()) if (old.owner === userId && !["accepted","cancelled","superseded"].includes(old.value.state)) discard(old, "superseded", body.cv?.uploadId);
    versions(userId).generation++;
    state().identities.set(userId, structuredClone(body.identity));
    const profile = store.profile(userId);
    if (profile.filters === null) { profile.name = body.identity.name; profile.workplaceName = body.identity.workplaceName; }
    const jobId = store.nextId("enrichment");
    const active = sources.some(s => s.status === "waiting");
    const value: EnrichmentJob = {
      jobId, sources, state: active ? "queued" : "manual", phase: active ? "collecting" : "done",
      selectionGeneration: versions(userId).generation, draft: null, expiresAt: expiry(),
    };
    const input = structuredClone(body);
    if (input.publicProfile && "text" in input.publicProfile) input.publicProfile.text = "Recorded pasted input";
    state().jobs.set(jobId, { owner: userId, input, fingerprint: digest, value, baseTextVersion: versions(userId).text, draftVersion: 1 });
    return structuredClone(value);
  },
  async getEnrichment({ userId, params }) {
    const job = jobFor(userId, params.id);
    const value = job.value;
    if (value.state === "queued") {
      value.state = "running";
      value.sources = value.sources.map(s => s.status === "waiting" ? { ...s, status: "running" } : s);
    } else if (value.state === "running" && value.phase === "collecting") {
      if (job.input.identity.name.includes("[demo:stalled]")) value.state = "stalled";
      else value.phase = "writing";
    } else if (value.state === "running") finish(job);
    return structuredClone(value);
  },
  async retryEnrichment({ userId, params }) {
    const job = jobFor(userId, params.id);
    if (["queued","running"].includes(job.value.state)) fail("running", 409, 30);
    if (!["failed","partial","stalled"].includes(job.value.state) || Date.parse(job.value.expiresAt) <= Date.now()) fail("draft_superseded");
    job.input.identity.name = job.input.identity.name.replace(/\[demo:(partial|failed|stalled|reconnect)\]/g, "");
    job.baseTextVersion = versions(userId).text; job.draftVersion++;
    job.value.sources = job.value.sources.map(s => s.status === "not_selected" ? s : { ...s, status: "waiting", items: 0, reason: undefined, retryAfterSeconds: undefined });
    job.value.state = "queued"; job.value.phase = "collecting"; job.value.draft = null;
    return structuredClone(job.value);
  },
  async acceptEnrichment({ userId, params, body }) {
    const job = jobFor(userId, params.id);
    const acceptedInput = fingerprint(body);
    if (job.accepted) {
      if (job.accepted !== acceptedInput) fail("draft_superseded");
      return { person: store.get().people.get(userId) ?? null, sync: await sync(userId) };
    }
    if (job.value.selectionGeneration !== versions(userId).generation) fail("consent_changed");
    if (!job.value.draft || !["ready","partial"].includes(job.value.state) || job.value.draft.draftVersion !== body.draftVersion) fail("draft_superseded");
    if (body.baseTextVersion !== versions(userId).text || body.baseTextVersion !== job.baseTextVersion) fail("text_changed");
    const evidence = job.value.draft.evidence;
    if (new Set(body.evidenceIds).size !== body.evidenceIds.length || body.evidenceIds.some(id => !evidence.some(e => e.id === id))) fail("invalid_input", 400);
    const replaced = new Set(job.value.sources.filter(s => s.status === "done").map(s => s.source));
    const existing = state().evidence.get(userId) ?? fixtures.evidence.filter(e => e.personId === userId).map(e => ({
      ...e, sourceId: userId + ":github", source: "github" as const, excerpt: e.text, retrievedAt: new Date().toISOString(),
    }));
    const complete = [...existing.filter(e => !replaced.has(e.source)), ...evidence.filter(e => body.evidenceIds.includes(e.id))];
    state().evidence.set(userId, complete);
    for (const source of job.value.sources.filter(s => replaced.has(s.source))) {
      const docs = complete.filter(e => e.source === source.source);
      state().sources.set(source.sourceId, { owner: userId, removed: false, value: {
        id: source.sourceId, source: source.source, label: source.selection?.label ?? source.source,
        ...(source.selection?.url ? { url: source.selection.url } : {}), evidenceCount: docs.length, approvedAt: new Date().toISOString(),
      } });
    }
    const profile = store.profile(userId); profile.bio = body.bio; profile.expertise = body.expertise;
    noteProfileChange(userId, true); job.accepted = acceptedInput;
    job.value.state = "accepted"; job.value.draft.needsReview = false;
    if (job.input.cv) state().uploads.get(job.input.cv.uploadId)!.removed = true;
    return { person: store.get().people.get(userId) ?? null, sync: await sync(userId) };
  },
  async cancelEnrichment({ userId, params }) {
    const job = jobFor(userId, params.id);
    if (job.value.state === "accepted") fail("draft_superseded");
    discard(job);
    return structuredClone(job.value);
  },
  async enrichmentSources({ userId }) {
    store.profile(userId);
    return [...state().sources.values()].filter(s => s.owner === userId && !s.removed).map(s => structuredClone(s.value));
  },
  async removeEnrichmentSource({ userId, params }) {
    const source = owned(state().sources.get(params.id), userId);
    if (!source.removed) {
      source.removed = true; versions(userId).generation++;
      for (const job of state().jobs.values()) if (job.owner === userId) {
        if (job.value.state !== "accepted") discard(job);
        else job.value.draft = null;
      }
      state().evidence.set(userId, (state().evidence.get(userId) ?? []).filter(e => e.sourceId !== params.id));
      noteProfileChange(userId);
    }
    return { removed: true, reviewBio: true, sync: await sync(userId) };
  },
};

import { createHash, randomUUID } from "node:crypto";
import type { RouteBody, RouteResponse } from "@/contracts/routes";
import { DiscoverEnrichment, EnrichmentDiscovery, EnrichmentDraft, EnrichmentEvidence, EnrichmentIdentity, SourceProgress, StartEnrichment, UploadCv, type EnrichmentJob } from "@/contracts/enrichment";
import { INPUT_TTL_MS, JOB_HISTORY_MS, LEASE_MS, enrichmentError, type OwnerData, type PrivateJob } from "./model";
import { deferCleanup, mutateOwner, ownersDueForCleanup, readOwner } from "./storage";

export const fingerprint = (input: unknown) => createHash("sha256").update(JSON.stringify(input, (_key, value) =>
  value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value)).digest("hex");
const terminal = (job: PrivateJob) => ["accepted", "cancelled", "superseded", "manual"].includes(job.value.state);
// Older queued rows have no timestamp; their fixed input lifetime identifies the original enqueue time.
const queuedUntil = (job: PrivateJob) => (job.queuedAt ?? Date.parse(job.value.expiresAt) - INPUT_TTL_MS) + LEASE_MS;
export function clearCv(data: OwnerData) {
  if (data.cv) data.removedCvs.push({ id: data.cv.metadata.uploadId, expiresAt: Date.now()+INPUT_TTL_MS });
  data.cv = null;
}
export function discard(data: OwnerData, job: PrivateJob, state: "cancelled" | "superseded" | "failed", keepUpload?: string) {
  if (job.input?.cv?.uploadId === data.cv?.metadata.uploadId && data.cv?.metadata.uploadId !== keepUpload) clearCv(data);
  job.input = null; job.collected = []; job.lease = null; job.value.draft = null; job.value.state = state; job.value.phase = "done";
  delete job.synthesisCacheKeys;
}
export function expire(data: OwnerData) {
  const now = Date.now();
  const expiredCv = data.cv && Date.parse(data.cv.metadata.expiresAt) <= now ? data.cv.metadata.uploadId : null;
  if (expiredCv) clearCv(data);
  for (const job of data.jobs) {
    if (job.value.state === "failed" && job.input === null) continue;
    if (!terminal(job) && (Date.parse(job.value.expiresAt) <= now || (expiredCv && job.input?.cv?.uploadId === expiredCv))) {
      discard(data, job, "failed");
      job.value.sources = job.value.sources.map(s => s.status === "not_selected" ? s : { ...s, status: "failed", reason: s.source === "cv" && expiredCv ? "cv_expired" : "timeout" });
    } else if ((job.value.state === "queued" && queuedUntil(job) <= now)
      || (job.value.state === "running" && job.lease && job.lease.expiresAt <= now)) {
      job.value.state = "stalled"; job.lease = null;
      job.value.sources = job.value.sources.map(s => ["waiting", "running"].includes(s.status) ? { ...s, status: "failed", reason: "timeout" } : s);
    }
  }
  data.jobs = data.jobs.filter(j => Date.parse(j.value.expiresAt) + (JOB_HISTORY_MS - INPUT_TTL_MS) > now);
  data.discoveries = data.discoveries.filter(d => Date.parse(d.value.expiresAt) > now);
  data.removedCvs = data.removedCvs.filter(cv => cv.expiresAt > now);
}
function mutate<T>(owner: string, change: (data: OwnerData) => T) {
  return mutateOwner(owner, data => { expire(data); return change(data); });
}
function rate(data: OwnerData, action: keyof OwnerData["limits"], maximum: number) {
  const now = Date.now();
  const previous = data.limits[action];
  const limit = !previous || previous.since + 600_000 <= now ? { since: now, count: 0 } : previous;
  if (limit.count >= maximum) enrichmentError("rate_limited", 429, Math.max(1, Math.ceil((limit.since + 600_000 - now) / 1000)));
  limit.count++; data.limits[action] = limit;
}
function find(data: OwnerData, id: string) {
  const job = data.jobs.find(j => j.value.jobId === id);
  if (!job) enrichmentError("not_found", 404);
  return job;
}
function withLease(data: OwnerData, id: string, token: string) {
  const job = find(data, id);
  if (job.value.state !== "running" || job.lease?.token !== token || job.lease.expiresAt <= Date.now()
      || job.value.selectionGeneration !== data.generation || !job.input) enrichmentError("draft_superseded");
  return job;
}
function projection(data: OwnerData) {
  const latest = data.jobs.at(-1)?.value;
  return { identity: data.identity, job: latest ? { jobId: latest.jobId, state: latest.state } : null, pendingCv: data.cv?.metadata ?? null };
}
function validateIdentity(input: RouteBody<"saveEnrichmentIdentity">) {
  const value = EnrichmentIdentity.parse(input);
  if (value.orcid) {
    const digits = value.orcid.replaceAll("-", "");
    const total = [...digits.slice(0,15)].reduce((sum, n) => (sum + Number(n)) * 2, 0);
    const check = (12 - total % 11) % 11;
    if (digits[15] !== (check === 10 ? "X" : String(check))) enrichmentError("invalid_input", 400);
  }
  return value;
}

export const readPrivateState = (owner: string) => mutate(owner, projection);
export function saveIdentity(owner: string, input: RouteBody<"saveEnrichmentIdentity">) {
  const identity = validateIdentity(input);
  return mutate(owner, data => {
    rate(data, "identity", 30);
    if (fingerprint(data.identity) !== fingerprint(identity)) {
      data.generation++;
      for (const job of data.jobs) if (!["accepted", "cancelled", "superseded"].includes(job.value.state)) discard(data, job, "superseded");
    }
    data.identity = identity; return projection(data);
  });
}
export function stageCvText(owner: string, input: RouteBody<"uploadCv">) {
  const parsed = UploadCv.parse(input);
  if (!("text" in parsed)) enrichmentError("not_ready", 501);
  const uploadId = randomUUID();
  return mutate(owner, data => {
    rate(data, "upload", 6);
    for (const job of data.jobs) if (job.input?.cv?.uploadId === data.cv?.metadata.uploadId && job.input?.cv && !terminal(job)) discard(data, job, "cancelled");
    clearCv(data);
    const metadata = { uploadId, filename: null, characters: parsed.text.length, warnings: [], expiresAt: new Date(Date.now()+INPUT_TTL_MS).toISOString() };
    data.cv = { metadata, text: parsed.text }; return metadata;
  });
}
export function removeCv(owner: string, uploadId: string) {
  return mutate(owner, data => {
    const known = data.cv?.metadata.uploadId === uploadId || data.removedCvs.some(cv => cv.id === uploadId) || data.jobs.some(j => j.input?.cv?.uploadId === uploadId);
    if (!known) enrichmentError("not_found", 404);
    for (const job of data.jobs) if (job.input?.cv?.uploadId === uploadId && !terminal(job)) discard(data, job, "cancelled");
    if (data.cv?.metadata.uploadId === uploadId) clearCv(data);
    return { removed: true as const };
  });
}
export function recordDiscovery(owner: string, input: RouteBody<"discoverEnrichment">, value: RouteResponse<"discoverEnrichment">) {
  const lookup = DiscoverEnrichment.parse(input); const result = EnrichmentDiscovery.parse(value);
  if (lookup.source !== result.source || Date.parse(result.expiresAt) <= Date.now()) enrichmentError("invalid_input", 400);
  return mutate(owner, data => {
    rate(data, "discovery", 12);
    if (data.discoveries.length >= 16) data.discoveries.shift();
    data.discoveries.push({ input: lookup, value: result });
  });
}
function selected(data: OwnerData, input: RouteBody<"startEnrichment">, source: "research" | "public_profile", choice: { discoveryId: string; candidateId: string }) {
  const found = data.discoveries.find(d => d.value.discoveryId === choice.discoveryId);
  const expected = { source, name: input.identity.name, workplaceName: input.identity.workplaceName, rorId: input.identity.rorId, orcid: input.identity.orcid };
  if (!found || fingerprint(found.input) !== fingerprint(expected)) enrichmentError("selection_stale");
  const candidate = found.value.candidates.find(c => c.id === choice.candidateId);
  if (!candidate) enrichmentError("selection_stale");
  return { label: "name" in candidate ? candidate.name : candidate.title, url: candidate.url };
}
const prepared = (job: PrivateJob) => {
  if (job.value.state === "queued") job.dispatchToken ??= randomUUID();
  return { job: job.value, attempt: job.dispatchToken };
};
export async function findStartJob(owner: string, body: RouteBody<"startEnrichment">) {
  const data = await readOwner(owner);
  if (!data) return null;
  expire(data);
  const previous = data.jobs.find(j => j.key === body.idempotencyKey);
  if (previous && previous.fingerprint !== fingerprint(body)) enrichmentError("idempotency_conflict");
  return previous?.value ?? null;
}
export async function createJob(owner: string, body: RouteBody<"startEnrichment">, githubLogin: string | null, baseTextVersion = 0) {
  return (await prepareJob(owner, body, githubLogin, baseTextVersion)).job;
}
export function prepareJob(owner: string, body: RouteBody<"startEnrichment">, githubLogin: string | null, baseTextVersion = 0) {
  const input = StartEnrichment.parse(body); validateIdentity(input.identity);
  const jobId = randomUUID(); const keyHash = fingerprint(input);
  return mutate(owner, data => {
    const previous = data.jobs.find(j => j.key === input.idempotencyKey);
    if (previous) {
      if (previous.fingerprint !== keyHash) enrichmentError("idempotency_conflict");
      return prepared(previous);
    }
    rate(data, "start", 6);
    if (data.jobs.length >= 50) enrichmentError("rate_limited", 429, 3600);
    if (data.identity && fingerprint(data.identity) !== fingerprint(input.identity)) enrichmentError("selection_stale");
    if (input.github.import && !githubLogin) enrichmentError("github_not_connected");
    const research = input.research && !("skip" in input.research) ? selected(data, input, "research", input.research) : null;
    const page = input.publicProfile;
    const publicProfile = !page || "skip" in page ? null : "candidateId" in page ? selected(data, input, "public_profile", page)
      : "url" in page ? { label: "Public profile", url: page.url } : { label: "Profile text" };
    if (input.cv && data.cv?.metadata.uploadId !== input.cv.uploadId) enrichmentError("cv_expired");
    const selections = { github: input.github.import ? { label: "GitHub", url: `https://github.com/${githubLogin}` } : null,
      research, public_profile: publicProfile, cv: input.cv ? { label: data.cv!.metadata.filename ?? "Pasted CV text", filename: data.cv!.metadata.filename } : null };
    const sources: EnrichmentJob["sources"] = (["github", "research", "public_profile", "cv"] as const).map(source => ({ source,
      sourceId: `${owner}:${source}`, selection: selections[source], status: selections[source] ? "waiting" : "not_selected", items: 0 }));
    for (const old of data.jobs) if (!["accepted", "cancelled", "superseded"].includes(old.value.state)) discard(data, old, "superseded", input.cv?.uploadId);
    if (!input.cv) clearCv(data);
    const active = sources.some(s => s.status === "waiting");
    const value: EnrichmentJob = { jobId, selectionGeneration: ++data.generation, sources, state: active ? "queued" : "manual",
      phase: active ? "collecting" : "done", draft: null, expiresAt: new Date(Date.now()+INPUT_TTL_MS).toISOString() };
    data.identity = input.identity; data.jobs.push({ key: input.idempotencyKey, fingerprint: keyHash, input: active ? input : null,
      collected: [], value, lease: null, queuedAt: active ? Date.now() : undefined, baseTextVersion });
    return prepared(data.jobs.at(-1)!);
  });
}
export const getJob = (owner: string, id: string, textVersion?: number) => mutate(owner, data => {
  const job = find(data, id);
  if (job.value.draft && job.value.state !== "accepted" && textVersion !== undefined)
    job.value.draft.needsReview = job.value.draft.baseTextVersion !== textVersion;
  return job.value;
});
export function cancelJob(owner: string, id: string) {
  return mutate(owner, data => {
    const job = find(data, id); if (job.value.state === "accepted") enrichmentError("draft_superseded");
    discard(data, job, "cancelled"); return job.value;
  });
}
export async function retryJob(owner: string, id: string, textVersion?: number) {
  return (await prepareRetry(owner, id, textVersion)).job;
}
export function prepareRetry(owner: string, id: string, textVersion?: number) {
  return mutate(owner, data => {
    const job = find(data, id);
    if (["queued", "running"].includes(job.value.state)) {
      const deadline = job.value.state === "queued" ? queuedUntil(job) : job.lease?.expiresAt ?? Date.now()+30_000;
      enrichmentError("running", 409, Math.max(1, Math.ceil((deadline-Date.now())/1000)));
    }
    if (!["stalled", "failed", "partial"].includes(job.value.state) || !job.input || job.value.selectionGeneration !== data.generation) enrichmentError("draft_superseded");
    rate(data, "retry", 6);
    job.value.sources = job.value.sources.map(s => ["not_selected", "done", "empty"].includes(s.status) ? s : { ...s, status: "waiting", items: 0, reason: undefined, retryAfterSeconds: undefined });
    job.value.state = "queued"; job.value.draft = null;
    job.value.phase = job.value.sources.some(s => s.status === "waiting") ? "collecting" : "writing";
    job.lease = null; job.queuedAt = Date.now(); job.dispatchToken = randomUUID();
    if (textVersion !== undefined) job.baseTextVersion = textVersion;
    return prepared(job);
  });
}
export function claimJob(owner: string, id: string, dispatchToken?: string) {
  const token = randomUUID();
  return mutate(owner, data => {
    const job = find(data, id);
    if (dispatchToken !== undefined && job.dispatchToken !== dispatchToken) enrichmentError("draft_superseded");
    if (job.value.state === "running") enrichmentError("running", 409, 30);
    if (job.value.state !== "queued" || !job.input || job.value.selectionGeneration !== data.generation) enrichmentError("draft_superseded");
    job.lease = { token, expiresAt: Date.now()+LEASE_MS }; job.value.state = "running";
    job.value.sources = job.value.sources.map(s => s.status === "waiting" ? { ...s, status: "running" } : s);
    return { token, input: job.input, value: job.value, collected: job.collected,
      cvText: job.input.cv && data.cv?.metadata.uploadId === job.input.cv.uploadId ? data.cv.text : null };
  });
}
export const ensureLease = (owner: string, id: string, token: string) => mutate(owner, data => {
  withLease(data, id, token);
});
export function recordCollection(owner: string, id: string, token: string, sources: EnrichmentJob["sources"], evidence: unknown) {
  const docs = EnrichmentEvidence.array().max(36).parse(evidence);
  const progress = SourceProgress.array().length(4).parse(sources);
  return mutate(owner, data => {
    const job = withLease(data, id, token);
    if (progress.some((s, i) => s.source !== job.value.sources[i].source || s.sourceId !== job.value.sources[i].sourceId
      || fingerprint(s.selection) !== fingerprint(job.value.sources[i].selection)
      || (s.selection === null && s.status !== "not_selected"))) enrichmentError("invalid_input", 400);
    const ids = new Set(docs.map(e => e.id));
    if (ids.size !== docs.length || progress.some(s => s.items !== docs.filter(e => e.source === s.source).length) || docs.some(e => e.personId !== owner || !e.id.startsWith(`${owner}:${e.kind}:`)
      || !progress.some(s => s.source === e.source && s.sourceId === e.sourceId && s.status === "done")
      || (e.source === "cv" && (e.kind !== "cv" || e.url !== undefined))
      || (e.source === "research" && (e.kind !== "paper" || !e.url))
      || (e.source === "public_profile" && (e.kind !== "profile_page" || (!!job.input?.publicProfile && "text" in job.input.publicProfile && (e.url !== undefined || e.title !== "Profile text"))))
      || (e.source === "github" && (e.kind === "repo" ? !job.input?.github.repos : e.kind !== "profile_page" || !(job.input?.github.bio || job.input?.github.orgs)))
    ) || job.collected.some(old => !docs.some(doc => fingerprint(doc) === fingerprint(old)))) enrichmentError("invalid_input", 400);
    job.collected = docs; job.value.sources = progress;
    if (progress.every(s => !["waiting", "running"].includes(s.status))) job.value.phase = "writing";
    return job.value;
  });
}
export function failJob(owner: string, id: string, token: string, reason: "timeout" | "provider_down") {
  const safeReason = reason === "timeout" ? "timeout" : "provider_down";
  return mutate(owner, data => {
    const job = withLease(data, id, token);
    job.value.state = "failed"; job.lease = null;
    job.value.sources = job.value.sources.map(s => s.status === "running" ? { ...s, status: "failed", reason: safeReason } : s);
    return job.value;
  });
}
/** Internal worker completion: only collected evidence from the current lease may support a draft. */
export function finishDraft(owner: string, id: string, token: string,
  proposal: Pick<NonNullable<EnrichmentJob["draft"]>, "bio" | "bioEvidenceIds" | "expertise">) {
  return mutate(owner, data => {
    const job = withLease(data, id, token);
    const parsed = EnrichmentDraft.safeParse({ ...proposal, draftVersion: (job.draftVersion ?? 0) + 1,
      baseTextVersion: job.baseTextVersion ?? 0, evidence: job.collected, needsReview: false });
    if (!parsed.success || job.value.phase !== "writing" || job.value.sources.some(s => ["waiting", "running"].includes(s.status))) enrichmentError("invalid_input", 400);
    const draft = parsed.data;
    const references = [...draft.bioEvidenceIds, ...draft.expertise.flatMap(e => e.evidenceIds)];
    if (references.some(id => !job.collected.some(e => e.id === id)) || (draft.bio.trim() && !draft.bioEvidenceIds.length)
      || draft.expertise.some(e => !e.evidenceIds.length)) enrichmentError("invalid_input", 400);
    job.draftVersion = draft.draftVersion; job.value.draft = job.collected.length ? draft : null;
    const failed = job.value.sources.some(s => s.status === "failed");
    job.value.state = job.collected.length ? failed ? "partial" : "ready" : failed ? "failed" : "manual";
    job.value.phase = "done"; job.lease = null;
    return job.value;
  });
}
export async function cleanupExpired() {
  const owners = await ownersDueForCleanup();
  let failed = 0;
  for (const owner of owners) {
    try { await mutate(owner, () => undefined); }
    catch {
      failed++;
      // A failed deferral remains due; the failure count reports incomplete cleanup without private data.
      await deferCleanup(owner).catch(() => undefined);
    }
  }
  return { processed: owners.length - failed, failed };
}

import type { RouteBody, RouteResponse } from "@/contracts/routes";
import { AcceptEnrichment, SavedEnrichmentSource } from "@/contracts/enrichment";
import { approvedSnapshot, indexedEvidence, sourceRecords } from "../evidence";
import { readUser, syncProfile, toPerson } from "../service";
import { mutateApprovedProfile } from "./approved-storage";
import { enrichmentError } from "./model";
import { clearCv, discard, expire, fingerprint } from "./state";

async function synchronize(user: Awaited<ReturnType<typeof readUser>>): Promise<RouteResponse<"acceptEnrichment">> {
  const savedRevision = user.revision;
  indexedEvidence(user); sourceRecords(user);
  // Not retryable: a repeated approval can't index a profile until onboarding saves it (as the fake says).
  if (user.filters === null) return { person: null, sync: { status: "not_onboarded", retryable: false, savedRevision } };
  // Validate before treating a failure as an indexing outage.
  const person = toPerson(user);
  try { await syncProfile(user); return { person, sync: { status: "confirmed", retryable: false, savedRevision } }; }
  catch { return { person, sync: { status: "pending", retryable: true, savedRevision } }; }
}

export async function acceptEnrichment(owner: string, id: string, input: RouteBody<"acceptEnrichment">) {
  const parsed = AcceptEnrichment.safeParse(input);
  if (!parsed.success) enrichmentError("invalid_input", 400);
  const body = parsed.data; const digest = fingerprint(body);
  const saved = await mutateApprovedProfile(owner, (user, data) => {
    expire(data);
    const job = data.jobs.find(j => j.value.jobId === id);
    if (!job) enrichmentError("not_found", 404);
    if (job.accepted) {
      if (job.accepted.fingerprint !== digest) enrichmentError("draft_superseded");
      return false;
    }
    if (job.value.selectionGeneration !== data.generation) enrichmentError("consent_changed");
    if (job.value.sources.some(s => s.reason === "cv_expired")) enrichmentError("cv_expired");
    const draft = job.value.draft;
    if (!draft || !["ready", "partial"].includes(job.value.state) || draft.draftVersion !== body.draftVersion) enrichmentError("draft_superseded");
    if (draft.baseTextVersion !== body.baseTextVersion || body.baseTextVersion !== user.textVersion) enrichmentError("text_changed");
    if (new Set(body.evidenceIds).size !== body.evidenceIds.length || body.evidenceIds.some(id => !draft.evidence.some(e => e.id === id))) enrichmentError("invalid_input", 400);
    if (fingerprint(draft.evidence) !== fingerprint(job.collected)) enrichmentError("provider_down", 503);
    if (draft.evidence.some(e => !job.value.sources.some(s => s.source === e.source && s.sourceId === e.sourceId && s.status === "done"))
      || job.value.sources.some(s => s.items !== draft.evidence.filter(e => e.source === s.source).length)) enrichmentError("provider_down", 503);
    // Only a source that returned evidence replaces its approved snapshot; an empty result (often transient) keeps it, as the fake does.
    const replaced = new Set(job.value.sources.filter(s => s.status === "done").map(s => s.source));
    const sources = sourceRecords(user).filter(s => !replaced.has(s.source));
    const docs = [...approvedSnapshot(user).filter(e => !replaced.has(e.source)), ...draft.evidence.filter(e => body.evidenceIds.includes(e.id))];
    user.profileEvidence = approvedSnapshot({ ...user, profileEvidence: docs });
    for (const source of job.value.sources.filter(s => replaced.has(s.source))) sources.push({
      id: source.sourceId, source: source.source, label: source.selection?.label ?? source.source,
      ...(source.selection?.url ? { url: source.selection.url } : {}), evidenceCount: docs.filter(e => e.source === source.source).length,
      approvedAt: new Date().toISOString(),
    });
    user.profileSources = sources;
    if (user.bio !== body.bio || fingerprint(user.expertise ?? []) !== fingerprint(body.expertise)) user.textVersion++;
    user.bio = body.bio; user.expertise = body.expertise; user.profileEvidencePending = true;
    if (replaced.has("github")) {
      user.githubEvidence = indexedEvidence(user).filter(e => e.kind === "repo"); user.githubEvidencePending = false;
    }
    if (job.input?.cv?.uploadId === data.cv?.metadata.uploadId && job.input?.cv) clearCv(data);
    job.input = null; job.collected = []; job.lease = null; job.value.draft = null;
    delete job.synthesisCacheKeys;
    job.value.state = "accepted"; job.value.phase = "done";
    job.accepted = { fingerprint: digest, savedRevision: user.revision + 1 };
    return true;
  });
  return synchronize(saved);
}

export async function enrichmentSources(owner: string): Promise<RouteResponse<"enrichmentSources">> {
  return sourceRecords(await readUser(owner)).filter(s => !s.removed).map(source => {
    const value = { ...source }; delete value.removed; return SavedEnrichmentSource.parse(value);
  });
}

export async function removeEnrichmentSource(owner: string, id: string): Promise<RouteResponse<"removeEnrichmentSource">> {
  const saved = await mutateApprovedProfile(owner, (user, data) => {
    const sources = sourceRecords(user); const source = sources.find(s => s.id === id);
    if (!source) enrichmentError("not_found", 404);
    if (source.removed) return false;
    expire(data); data.generation++; data.discoveries = [];
    for (const job of data.jobs) {
      if (job.value.state !== "accepted") discard(data, job, "cancelled");
      else { job.input = null; job.collected = []; job.value.draft = null; delete job.synthesisCacheKeys; }
    }
    if (source.source === "cv") clearCv(data);
    user.profileEvidence = approvedSnapshot(user).filter(e => e.sourceId !== id);
    user.profileSources = sources.map(s => s.id === id ? { ...s, removed: true, evidenceCount: 0 } : s);
    if (source.source === "github") { user.githubEvidence = []; user.githubEvidencePending = false; }
    user.profileEvidencePending = true;
    return true;
  });
  return { removed: true, reviewBio: true, sync: (await synchronize(saved)).sync };
}

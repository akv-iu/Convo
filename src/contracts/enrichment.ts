import { z } from "zod";
import { EvidenceKind, Person, SourceUrl } from "./types";

export { SourceUrl } from "./types";
export const MAX_CV_BYTES = 2 * 1024 * 1024;
export const MAX_SOURCE_TEXT = 30_000;
const id = z.string().trim().min(1).max(200);
const version = z.number().int().nonnegative();
const years = z.array(z.number().int().min(1000).max(2100)).max(100).nullable();
export const EnrichmentSource = z.enum(["github", "research", "public_profile", "cv"]);
export type EnrichmentSource = z.infer<typeof EnrichmentSource>;
export const EnrichmentIdentity = z.strictObject({
  name: z.string().trim().min(1).max(80), country: z.string().regex(/^[A-Z]{2}$/),
  workplaceName: z.string().trim().min(1).max(200).nullable(),
  rorId: z.string().regex(/^https:\/\/ror\.org\/0[0-9a-hj-km-np-tv-z]{6}\d{2}$/).nullable(),
  orcid: z.string().regex(/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/).nullable(),
});
export const EnrichmentReason = z.enum([
  "github_reconnect", "github_nothing_public", "github_connect_cancelled", "github_linked_elsewhere",
  "github_not_connected", "sign_in_cancelled", "research_no_match", "page_blocked", "page_unavailable",
  "cv_unreadable", "cv_encrypted", "cv_too_large", "cv_unsupported", "cv_expired", "rate_limited",
  "timeout", "provider_down", "unknown",
]);
export const EnrichmentErrorCode = z.enum([
  ...EnrichmentReason.options, "feature_disabled", "invalid_input", "selection_stale", "running",
  "text_changed", "consent_changed", "draft_superseded", "idempotency_conflict",
  "sign_in_required", "forbidden", "not_found", "not_ready", "off_contract",
]);
export type EnrichmentErrorCode = z.infer<typeof EnrichmentErrorCode>;
export const EnrichmentError = z.strictObject({
  error: z.string().max(200), code: EnrichmentErrorCode,
  retryAfterSeconds: z.number().int().min(1).max(86_400).optional(),
});
export const DiscoverEnrichment = EnrichmentIdentity.omit({ country: true }).extend({
  source: z.enum(["research", "public_profile"]),
});
const author = z.strictObject({
  id, name: z.string().min(1).max(200), url: SourceUrl, orcid: EnrichmentIdentity.shape.orcid,
  affiliations: z.array(z.strictObject({ name: z.string().max(200), years })).max(3),
  worksCount: z.number().int().nonnegative(),
  samplePapers: z.array(z.strictObject({ title: z.string().max(300), year: z.number().int().min(1000).max(2100).nullable(), url: SourceUrl.nullable() })).max(3),
});
const page = z.strictObject({
  id, title: z.string().min(1).max(200), url: SourceUrl, domain: z.string().max(253),
  snippet: z.string().max(300),
}).refine(value => {
  try { return new URL(value.url).hostname === value.domain; } catch { return false; }
}, "Domain must match the URL");
const discovery = z.strictObject({
  discoveryId: id, status: z.enum(["ok", "no_matches", "unavailable"]),
  reason: EnrichmentReason.optional(), retryAfterSeconds: z.number().int().min(1).max(86_400).optional(),
  expiresAt: z.iso.datetime({ offset: true }),
});
export const EnrichmentDiscovery = z.discriminatedUnion("source", [
  discovery.extend({ source: z.literal("research"), candidates: z.array(author).max(4) }),
  discovery.extend({ source: z.literal("public_profile"), candidates: z.array(page).max(4) }),
]);
export const UploadCv = z.union([
  z.strictObject({ consent: z.literal(true), file: z.file().min(1).max(MAX_CV_BYTES)
    .mime(["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"])
    .refine(file => file.name.length > 0 && file.name.length <= 255, "Invalid filename") }),
  z.strictObject({ consent: z.literal(true), text: z.string().trim().min(1).max(MAX_SOURCE_TEXT) }),
]);
export const CvUpload = z.strictObject({
  uploadId: id, filename: z.string().min(1).max(255).nullable(),
  characters: z.number().int().min(0).max(MAX_SOURCE_TEXT),
  warnings: z.array(EnrichmentReason).max(5), expiresAt: z.iso.datetime({ offset: true }),
});
const chosen = z.strictObject({ discoveryId: id, candidateId: id });
export const StartEnrichment = z.strictObject({
  identity: EnrichmentIdentity, idempotencyKey: z.uuid(),
  github: z.strictObject({ import: z.boolean(), bio: z.boolean(), repos: z.boolean(), orgs: z.boolean() })
    .refine(value => !value.import || value.bio || value.repos || value.orgs, "Choose a GitHub category or turn its import off"),
  research: z.union([z.strictObject({ skip: z.literal(true) }), chosen]).nullable(),
  publicProfile: z.union([
    z.strictObject({ skip: z.literal(true) }), chosen, z.strictObject({ url: SourceUrl }),
    z.strictObject({ kind: z.literal("text"), text: z.string().trim().min(1).max(MAX_SOURCE_TEXT) }),
  ]).nullable(),
  cv: z.strictObject({ uploadId: id }).nullable(),
});
export const EnrichmentEvidence = z.strictObject({
  id, personId: id, sourceId: id, source: EnrichmentSource, kind: EvidenceKind,
  title: z.string().min(1).max(300), excerpt: z.string().min(1).max(3000),
  url: SourceUrl.optional(), retrievedAt: z.iso.datetime({ offset: true }),
});
export const SourceProgress = z.strictObject({
  source: EnrichmentSource, sourceId: id,
  status: z.enum(["not_selected", "waiting", "running", "done", "empty", "failed", "removed"]),
  reason: EnrichmentReason.optional(), retryAfterSeconds: z.number().int().min(1).max(86_400).optional(),
  items: z.number().int().min(0).max(36),
  selection: z.strictObject({ label: z.string().max(300), url: SourceUrl.optional(), filename: z.string().max(255).nullable().optional() }).nullable(),
  github: z.strictObject({ bio: z.boolean(), repos: z.number().int().min(0).max(20), orgs: z.number().int().nonnegative() }).optional(),
});
export const EnrichmentDraft = z.strictObject({
  draftVersion: version, baseTextVersion: version, bio: z.string().max(600),
  bioEvidenceIds: z.array(id).max(36),
  expertise: z.array(z.strictObject({ label: z.string().trim().min(1).max(60), evidenceIds: z.array(id).max(36) })).max(8),
  evidence: z.array(EnrichmentEvidence).max(36), needsReview: z.boolean(),
});
export const EnrichmentJob = z.strictObject({
  jobId: id, state: z.enum(["queued", "running", "stalled", "ready", "partial", "failed", "cancelled", "superseded", "accepted", "manual"]),
  phase: z.enum(["collecting", "writing", "done"]), selectionGeneration: version,
  sources: z.array(SourceProgress).length(4), draft: EnrichmentDraft.nullable(),
  expiresAt: z.iso.datetime({ offset: true }),
});
export type EnrichmentJob = z.infer<typeof EnrichmentJob>;
export const EnrichmentState = z.strictObject({
  signIn: z.strictObject({ provider: z.enum(["google", "github"]) }),
  github: z.strictObject({ connected: z.boolean(), login: z.string().nullable() }),
  onboarded: z.boolean(), identity: EnrichmentIdentity.nullable(),
  job: EnrichmentJob.pick({ jobId: true, state: true }).nullable(), pendingCv: CvUpload.nullable(),
});
export const ConnectGitHub = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("connected"), login: z.string().min(1) }),
  z.strictObject({ status: z.literal("redirect"), path: z.string().startsWith("/api/auth/").max(2048) }),
]);
export const AcceptEnrichment = z.strictObject({
  draftVersion: version, baseTextVersion: version, bio: z.string().max(600),
  expertise: z.array(z.string().trim().min(1).max(60)).max(8), evidenceIds: z.array(id).max(36),
});
export const EnrichmentSync = z.strictObject({
  status: z.enum(["confirmed", "pending", "not_onboarded"]), retryable: z.boolean(), savedRevision: version,
});
export const AcceptedEnrichment = z.strictObject({ person: Person.nullable(), sync: EnrichmentSync });
export const SavedEnrichmentSource = z.strictObject({
  id, source: EnrichmentSource, label: z.string().max(300), url: SourceUrl.optional(),
  evidenceCount: z.number().int().min(0).max(36), approvedAt: z.iso.datetime({ offset: true }),
});

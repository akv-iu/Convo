import { z } from "zod";
import { EvidenceDoc, Person } from "./types";

export const MAX_CV_BYTES = 2 * 1024 * 1024;
export const MAX_SOURCE_TEXT = 30_000;
export const EnrichmentSource = z.enum(["github", "research", "public_profile", "cv"]);
export type EnrichmentSource = z.infer<typeof EnrichmentSource>;
const id = z.string().trim().min(1).max(200);
const version = z.number().int().nonnegative();
export const SourceUrl = z.url().max(2048).refine(value => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch { return false; }
}, "Use an HTTPS URL without credentials");

export const EnrichmentIdentity = z.strictObject({
  name: z.string().trim().min(1).max(200),
  country: z.string().regex(/^[A-Z]{2}$/),
  workplaceName: z.string().trim().min(1).max(200).nullable(),
  rorId: z.string().regex(/^https:\/\/ror\.org\/[0-9a-z]{9}$/).nullable(),
  orcid: z.string().regex(/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/).nullable(),
});
export const EnrichmentPermissions = z.strictObject({
  github: z.strictObject({ bio: z.boolean(), repos: z.boolean(), organisations: z.boolean() }),
  research: z.boolean(), publicProfile: z.boolean(), cv: z.boolean(),
});
export const EnrichmentReason = z.enum([
  "not_selected", "no_public_data", "no_matches", "reconnect_github", "access_denied",
  "rate_limited", "temporarily_unavailable", "unsupported_format", "file_too_large",
  "unreadable_document", "encrypted_document", "scan_needs_text", "unsafe_url",
  "expired_input", "stale_selection", "no_evidence", "import_unavailable",
]);
export const SourceProgress = z.strictObject({
  source: EnrichmentSource, sourceId: id,
  status: z.enum(["not_selected", "queued", "collecting", "complete", "empty", "failed", "removed"]),
  reason: EnrichmentReason.nullable(),
  retryAfterSeconds: z.number().int().min(1).max(86_400).nullable(),
});
const candidate = z.strictObject({
  id, title: z.string().min(1).max(300), url: SourceUrl,
  domain: z.string().min(1).max(253), snippet: z.string().max(1000),
});
export const AuthorCandidate = candidate.extend({
  orcid: EnrichmentIdentity.shape.orcid,
  affiliations: z.array(z.string().max(200)).max(5),
  samplePapers: z.array(z.string().max(300)).max(3),
});
const discoveryStatus = z.strictObject({
  status: z.enum(["ok", "no_matches", "unavailable", "not_selected"]),
  reason: EnrichmentReason.nullable(),
  retryAfterSeconds: z.number().int().min(1).max(86_400).nullable(),
});
export const DiscoverEnrichment = z.strictObject({
  identity: EnrichmentIdentity,
  sources: z.strictObject({ research: z.boolean(), publicProfile: z.boolean() }),
});
export const EnrichmentDiscovery = z.strictObject({
  discoveryId: id, expiresAt: z.iso.datetime({ offset: true }),
  research: discoveryStatus.extend({ candidates: z.array(AuthorCandidate).max(4) }),
  publicProfile: discoveryStatus.extend({ candidates: z.array(candidate).max(4) }),
});

// The multipart adapter supplies a File, never a JSON representation of one.
export const UploadCv = z.union([
  z.strictObject({ consent: z.literal(true), file: z.file().min(1).max(MAX_CV_BYTES)
    .mime(["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"])
    .refine(file => file.name.length > 0 && file.name.length <= 255, "Invalid filename") }),
  z.strictObject({ consent: z.literal(true), text: z.string().trim().min(1).max(MAX_SOURCE_TEXT) }),
]);
export const CvUpload = z.strictObject({
  uploadId: id, filename: z.string().min(1).max(255),
  extractedCharacters: z.number().int().min(0).max(MAX_SOURCE_TEXT),
  warnings: z.array(EnrichmentReason).max(5), expiresAt: z.iso.datetime({ offset: true }),
});
const publicSelection = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("candidate"), candidateId: id }),
  z.strictObject({ kind: z.literal("url"), url: SourceUrl }),
  z.strictObject({ kind: z.literal("text"), text: z.string().trim().min(1).max(MAX_SOURCE_TEXT) }),
]);
export const StartEnrichment = z.strictObject({
  identity: EnrichmentIdentity, permissions: EnrichmentPermissions,
  discoveryId: id.nullable(), authorId: id.nullable(),
  publicProfile: publicSelection.nullable(), cvUploadId: id.nullable(),
  idempotencyKey: z.uuid(),
}).superRefine((value, ctx) => {
  if ((!value.permissions.research && value.authorId) ||
      (!value.permissions.publicProfile && value.publicProfile) ||
      (!value.permissions.cv && value.cvUploadId) ||
      ((value.authorId || value.publicProfile?.kind === "candidate") && !value.discoveryId)) {
    ctx.addIssue({ code: "custom", message: "Selections must have permission and a discovery when needed" });
  }
});
export const EnrichmentEvidence = EvidenceDoc.extend({
  id, personId: id, title: z.string().min(1).max(300), text: z.string().min(1).max(3000),
  url: SourceUrl.optional(), sourceId: id, source: EnrichmentSource, externalId: id,
  retrievedAt: z.iso.datetime({ offset: true }),
});
export const EnrichmentDraft = z.strictObject({
  version: version, baseTextRevision: version,
  bio: z.string().max(600), expertise: z.array(z.string().trim().min(1).max(60)).max(8),
  evidenceIds: z.array(id).max(36),
});
export const EnrichmentJob = z.strictObject({
  jobId: id, state: z.enum(["queued", "collecting", "synthesizing", "ready", "partial", "failed", "stalled", "cancelled", "accepted", "manual"]),
  selectionGeneration: version, textRevision: version, needsReview: z.boolean(),
  sources: z.array(SourceProgress).length(4),
  draft: EnrichmentDraft.nullable(), evidence: z.array(EnrichmentEvidence).max(36),
  expiresAt: z.iso.datetime({ offset: true }),
});
export type EnrichmentJob = z.infer<typeof EnrichmentJob>;
export const AcceptEnrichment = EnrichmentDraft.pick({ version: true, baseTextRevision: true, bio: true, expertise: true, evidenceIds: true });
export const EnrichmentSync = z.strictObject({
  status: z.enum(["synced", "pending", "not_onboarded"]),
  retryable: z.boolean(), savedRevision: version,
});
export const AcceptedEnrichment = z.strictObject({ person: Person.nullable(), sync: EnrichmentSync });
export const SavedEnrichmentSource = z.strictObject({
  sourceId: id, source: EnrichmentSource, title: z.string().max(300),
  url: SourceUrl.nullable(), evidenceCount: z.number().int().min(0).max(36),
});
export const EnrichmentError = z.strictObject({
  error: z.string().max(200),
  code: z.enum(["feature_disabled", "not_ready", "sign_in_required", "forbidden", "bad_request", "too_large", "unsupported_media_type", "not_found", "conflict", "rate_limited", "unavailable", "off_contract"]),
});

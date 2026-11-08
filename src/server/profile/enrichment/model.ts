import { z } from "zod";
import { createHash } from "node:crypto";
import { CvUpload, DiscoverEnrichment, EnrichmentDiscovery, EnrichmentEvidence, EnrichmentIdentity, EnrichmentJob, StartEnrichment, type EnrichmentErrorCode } from "@/contracts/enrichment";

export const INPUT_TTL_MS = 24 * 60 * 60 * 1000;
export const LEASE_MS = 90_000;
export const JOB_HISTORY_MS = 2 * INPUT_TTL_MS;
const lease = z.object({ token: z.uuid(), expiresAt: z.number() });
export const PrivateJob = z.strictObject({
  fingerprint: z.string(), key: z.uuid(), input: StartEnrichment.nullable(), value: EnrichmentJob,
  lease: lease.nullable(), queuedAt: z.number().int().nonnegative().optional(), dispatchToken: z.uuid().optional(), collected: z.array(EnrichmentEvidence).max(36),
  baseTextVersion: z.number().int().nonnegative().optional(), draftVersion: z.number().int().nonnegative().optional(),
  accepted: z.object({ fingerprint: z.string(), savedRevision: z.number().int().nonnegative() }).optional(),
  synthesisCacheKeys: z.array(z.string().max(200)).max(8).optional(),
});
export type PrivateJob = z.infer<typeof PrivateJob>;
export const OwnerData = z.strictObject({
  schemaVersion: z.literal(1),
  identity: EnrichmentIdentity.nullable(), generation: z.number().int().nonnegative(),
  cv: z.object({ metadata: CvUpload, text: z.string().max(30_000) }).nullable(),
  removedCvs: z.array(z.object({ id: z.uuid(), expiresAt: z.number() })).max(1000),
  discoveries: z.array(z.object({ input: DiscoverEnrichment, value: EnrichmentDiscovery })).max(16),
  jobs: z.array(PrivateJob).max(50),
  limits: z.partialRecord(z.enum(["identity", "upload", "start", "retry", "discovery"]), z.object({ since: z.number(), count: z.number().int().nonnegative() })),
});
export type OwnerData = z.infer<typeof OwnerData>;
export const cacheKeys = (data: OwnerData) => data.jobs.flatMap(job => job.synthesisCacheKeys ?? []);
export const profileCachePrefix = (owner: string) => `profile:${createHash("sha256").update(JSON.stringify(owner)).digest("hex")}:`;
export const emptyOwnerData = (): OwnerData => ({ schemaVersion: 1, identity: null, generation: 0, cv: null, removedCvs: [], discoveries: [], jobs: [], limits: {} });
export class StateError extends Error {
  constructor(readonly code: EnrichmentErrorCode, readonly status: number, readonly retryAfterSeconds?: number) { super("Profile enrichment could not complete."); }
}
export function enrichmentError(code: EnrichmentErrorCode, status = 409, retryAfterSeconds?: number): never {
  throw new StateError(code, status, retryAfterSeconds);
}

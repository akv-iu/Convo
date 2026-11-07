import type { RouteBody } from "../routes";

export const enrichmentIdentity = {
  name: "Demo Researcher", country: "US", workplaceName: "Demo University",
  rorId: null, orcid: null,
};
export const enrichmentPermissions = {
  github: { bio: true, repos: true, organisations: true }, research: true, publicProfile: true, cv: true,
};
export const enrichmentStart = (): RouteBody<"startEnrichment"> => ({
  identity: { ...enrichmentIdentity }, permissions: structuredClone(enrichmentPermissions),
  discoveryId: null, authorId: null, publicProfile: null, cvUploadId: null,
  idempotencyKey: crypto.randomUUID(),
});

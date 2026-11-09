import type { RouteBody } from "../routes";

export const enrichmentIdentity = {
  name: "Demo Researcher", country: "US", workplaceName: "Demo University", rorId: null, orcid: null,
};
export const enrichmentStart = (): RouteBody<"startEnrichment"> => ({
  identity: { ...enrichmentIdentity }, idempotencyKey: crypto.randomUUID(),
  github: { import: true, bio: true, repos: true, orgs: true },
  research: null, publicProfile: null, cv: null,
});

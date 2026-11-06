// A1's sign-in form writes these source IDs before the GitHub redirect.
export const CONSENT_COOKIE = "convo_consent";
export const consentSources = ["profile", "repos", "orgs"] as const;
export type GitHubConsent = readonly (typeof consentSources)[number][];

export function parseConsent(value: string | undefined): GitHubConsent {
  const chosen = new Set(value?.split(",") ?? []);
  return consentSources.filter((source) => chosen.has(source));
}

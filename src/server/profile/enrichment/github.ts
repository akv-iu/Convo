import { EnrichmentEvidence, StartEnrichment } from "@/contracts/enrichment";
import type { RouteBody } from "@/contracts/routes";
import type { z } from "zod";
import { GitHubRequestError, loadGitHubIdentity, loadGitHubProfile } from "../github";
import { buildProfile, MAX_REPO_EVIDENCE } from "../index";
import type { GitHubConsent } from "../consent";
import { enrichmentError, StateError } from "./model";

type Evidence = z.infer<typeof EnrichmentEvidence>;
type Collected = { evidence: Evidence[]; github: { bio: boolean; repos: number; orgs: number }; reason?: "github_nothing_public" };

/** Server-only collection; caller supplies the current owner-bound connection and checks its job lease. */
export async function collectGitHubEvidence(owner: string, accountId: string | null, accessToken: string | undefined,
  selection: RouteBody<"startEnrichment">["github"]): Promise<Collected> {
  const parsed = StartEnrichment.shape.github.safeParse(selection);
  if (!parsed.success) enrichmentError("invalid_input", 400);
  const chosen = parsed.data;
  const result: Collected = { evidence: [], github: { bio: false, repos: 0, orgs: 0 } };
  if (!chosen.import) return result;
  if (!accountId) enrichmentError("github_not_connected");
  if (!/^[1-9]\d*$/.test(accountId)) enrichmentError("invalid_input", 400);
  if (!accessToken?.trim()) enrichmentError("github_reconnect");
  try {
    const identity = await loadGitHubIdentity(accessToken);
    if (String(identity.id) !== accountId) enrichmentError("github_reconnect");
    const consent: GitHubConsent = [...(chosen.bio ? ["profile" as const] : []), ...(chosen.repos ? ["repos" as const] : []), ...(chosen.orgs ? ["orgs" as const] : [])];
    const profile = await loadGitHubProfile(accountId, identity, accessToken, consent);
    const bio = chosen.bio ? (profile.bio ?? "").replace(/\s+/g, " ").trim().slice(0, 600) : "";
    let summary = bio ? `Bio: ${bio}` : "";
    const orgs: string[] = [];
    for (const org of [...new Set(profile.orgs.map(o => o.login))].sort()) {
      const text = `${bio ? `Bio: ${bio}\n` : ""}Public organisations: ${[...orgs, org].join(", ")}`;
      if (text.length > 3000) break;
      orgs.push(org); summary = text;
    }
    const retrievedAt = new Date().toISOString();
    const common = { personId: owner, sourceId: `${owner}:github`, source: "github" as const, retrievedAt };
    if (summary) result.evidence.push(EnrichmentEvidence.parse({ ...common, id: `${owner}:profile_page:github-summary`,
      kind: "profile_page", title: "GitHub profile", excerpt: summary, url: `https://github.com/${profile.login}` }));
    const seen = new Set<string>();
    const repos = buildProfile(owner, profile).evidence.filter(repo => {
      const id = repo.id.toLowerCase();
      if (seen.has(id)) return false;
      seen.add(id); return true;
    }).slice(0, MAX_REPO_EVIDENCE - result.evidence.length);
    for (const repo of repos) {
      const url = new URL(repo.url!);
      const path = /^\/([^/]+)\/([^/]+)\/?$/.exec(url.pathname);
      if (url.username || url.password || url.port || url.search || url.hash || !path
        || decodeURIComponent(path[1]).toLowerCase() !== profile.login.toLowerCase()
        || decodeURIComponent(path[2]).toLowerCase() !== repo.title.toLowerCase()) enrichmentError("provider_down", 503);
      result.evidence.push(EnrichmentEvidence.parse({ ...common, id: repo.id, kind: repo.kind,
        title: repo.title, excerpt: repo.text.slice(0, 3000), url: repo.url }));
    }
    result.github = { bio: !!bio, repos: repos.length, orgs: orgs.length };
    if (!result.evidence.length) result.reason = "github_nothing_public";
    return result;
  } catch (error) {
    if (error instanceof StateError) throw error;
    if (error instanceof GitHubRequestError) enrichmentError(error.reason, error.reason === "github_reconnect" ? 409 : error.reason === "rate_limited" ? 429 : 503, error.retryAfterSeconds);
    enrichmentError("provider_down", 503);
  }
}

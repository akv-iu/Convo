/**
 * Build public profile fields and repository evidence. Onboarding supplies
 * filters and availability before B1 can ingest a complete Person.
 */
import type { EvidenceDoc, Person } from "@/contracts/types";

export interface GitHubProfileInput {
  login: string;
  name: string | null;
  bio: string | null;
  repos: { name: string; description: string | null; language: string | null; html_url: string; stargazers_count: number }[];
  orgs: { login: string }[];
}

export function buildProfile(userId: string, gh: GitHubProfileInput): { person: Omit<Person, "filters" | "freeTimes">; evidence: EvidenceDoc[] } {
  const languages = [...new Set(gh.repos.map((r) => r.language).filter((l): l is string => !!l))].sort();
  const evidence: EvidenceDoc[] = [...gh.repos]
    .sort((a, b) => b.stargazers_count - a.stargazers_count || a.name.localeCompare(b.name))
    .slice(0, 20)
    .map((r) => ({
      id: `${userId}:repo:${r.name}`,
      personId: userId,
      kind: "repo",
      title: r.name,
      text: [r.description?.trim() || `${r.name}.`, r.language ? `Language: ${r.language}.` : ""].filter(Boolean).join(" "),
      url: r.html_url,
    }));
  return {
    person: {
      id: userId,
      name: gh.name?.trim() || gh.login,
      githubLogin: gh.login,
      bio: gh.bio ?? "",
      languages,
      organisations: gh.orgs.map((o) => o.login),
      synthetic: false,
    },
    evidence,
  };
}

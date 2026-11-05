/**
 * Profile builder (B2): turn a GitHub user into a Person plus EvidenceDocs
 * (one per notable repo, language and organisation), then ingest them.
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
  const languages = [...new Set(gh.repos.map((r) => r.language).filter((l): l is string => !!l))];
  const evidence: EvidenceDoc[] = gh.repos
    .filter((r) => r.description)
    .slice(0, 20)
    .map((r) => ({
      id: `${userId}:repo:${r.name}`,
      personId: userId,
      kind: "repo",
      title: r.name,
      text: r.description ?? "",
      url: r.html_url,
    }));
  return {
    person: {
      id: userId,
      name: gh.name ?? gh.login,
      githubLogin: gh.login,
      bio: gh.bio ?? "",
      languages,
      organisations: gh.orgs.map((o) => o.login),
      synthetic: false,
    },
    evidence,
  };
}

/**
 * Build public profile fields and repository evidence. Onboarding supplies
 * filters and availability before B1 can ingest a complete Person.
 */
import type { EvidenceDoc, Person } from "@/contracts/types";

export const MAX_REPO_EVIDENCE = 20;
const ROUTINE = /neetcode|leetcode|hackerrank|codewars|submissions|assignment|homework|exercises|dotfiles|portfolio/i;

export interface GitHubProfileInput {
  login: string;
  name: string | null;
  bio: string | null;
  repos: { name: string; description: string | null; language: string | null; html_url: string; stargazers_count: number }[];
  orgs: { login: string }[];
}

export function buildProfile(userId: string, gh: GitHubProfileInput): { person: Omit<Person, "filters" | "freeTimes">; evidence: EvidenceDoc[] } {
  const languages = [...new Set(gh.repos.map((r) => r.language).filter((l): l is string => !!l))].sort();
  // Coding practice, coursework, portfolios and the profile README say little about someone's work: kept, but last.
  // ponytail: a name heuristic; read repo topics or READMEs if it misjudges real projects.
  const routine = (r: GitHubProfileInput["repos"][number]) =>
    ROUTINE.test(`${r.name} ${r.description ?? ""}`) || r.name.toLowerCase() === gh.login.toLowerCase();
  // Stable sort: ties keep GitHub's order (most recently updated first), not the alphabet.
  const evidence: EvidenceDoc[] = [...gh.repos]
    .sort((a, b) => Number(routine(a)) - Number(routine(b)) || b.stargazers_count - a.stargazers_count)
    .slice(0, MAX_REPO_EVIDENCE)
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

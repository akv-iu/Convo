import { z } from "zod";
import type { GitHubProfileInput } from "./index";

const login = z.string().regex(/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i);
const userSchema = z.object({
  id: z.number().int().positive(), login, name: z.string().nullable(), bio: z.string().nullable(),
});
const repoSchema = z.object({
  name: z.string().min(1), description: z.string().nullable(), language: z.string().nullable(),
  html_url: z.url({ protocol: /^https$/, hostname: /^github\.com$/ }),
  stargazers_count: z.number().int().nonnegative(), private: z.boolean(),
});
const orgSchema = z.object({ login });

export function githubUserId(accountId: string): string {
  if (!/^[1-9]\d*$/.test(accountId)) throw new Error("Invalid GitHub account ID");
  return `github:${accountId}`;
}

export async function loadGitHubProfile(accountId: string, profile: unknown, accessToken: string): Promise<GitHubProfileInput> {
  githubUserId(accountId);
  const user = userSchema.parse(profile);
  if (String(user.id) !== accountId || !accessToken) throw new Error("Invalid GitHub sign-in identity");

  const get = async (path: string): Promise<unknown> => {
    let response: Response;
    try {
      response = await fetch(`https://api.github.com/users/${user.login}/${path}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`, Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2026-03-10",
        },
        cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new Error("GitHub profile request failed");
    }
    if (!response.ok) throw new Error(`GitHub profile request failed (${response.status})`);
    return response.json();
  };

  // shortcut: import the latest 100 public repos and first 100 public orgs; paginate if larger profiles need full coverage.
  const [repoData, orgData] = await Promise.all([
    get("repos?type=owner&sort=updated&direction=desc&per_page=100"),
    get("orgs?per_page=100"),
  ]);
  const repos = z.array(repoSchema).parse(repoData).filter((repo) => !repo.private);
  return {
    login: user.login, name: user.name, bio: user.bio,
    repos: repos.map(({ name, description, language, html_url, stargazers_count }) => ({
      name, description, language, html_url, stargazers_count,
    })),
    orgs: z.array(orgSchema).parse(orgData),
  };
}

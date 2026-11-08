import { z } from "zod";
import type { GitHubProfileInput } from "./index";
import type { GitHubConsent } from "./consent";
import { readProviderJson } from "./provider-json";

export class GitHubRequestError extends Error {
  constructor(readonly reason: "github_reconnect" | "rate_limited" | "timeout" | "provider_down", readonly status?: number, readonly retryAfterSeconds?: number) {
    super(`GitHub profile request failed${status ? ` (${status})` : ""}`);
  }
}

const login = z.string().regex(/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i);
const userSchema = z.object({
  id: z.number().int().positive(), login, name: z.string().nullable(),
});
const bioSchema = z.object({ bio: z.string().nullable() });
const repoSchema = z.object({
  name: z.string().min(1), description: z.string().nullable(), language: z.string().nullable(),
  html_url: z.url({ protocol: /^https$/, hostname: /^github\.com$/ }),
  stargazers_count: z.number().int().nonnegative(), private: z.boolean(),
});
const orgSchema = z.object({ login });

async function githubGet(path: string, accessToken: string): Promise<unknown> {
  const signal = AbortSignal.timeout(10_000);
  try {
    const response = await fetch(`https://api.github.com/${path}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`, Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2026-03-10", "User-Agent": "convo",
      },
      cache: "no-store", redirect: "error", signal,
    });
    if (!response.ok) {
      const retry = response.headers.get("retry-after");
      const limited = response.status === 429 || (response.status === 403 && (response.headers.get("x-ratelimit-remaining") === "0" || retry !== null));
      if (limited) {
        const seconds = retry !== null ? Number(retry) || (Date.parse(retry) - Date.now()) / 1000
          : Number(response.headers.get("x-ratelimit-reset")) - Date.now() / 1000;
        throw new GitHubRequestError("rate_limited", response.status, Number.isFinite(seconds) && seconds > 0 ? Math.min(86400, Math.max(1, Math.ceil(seconds))) : 60);
      }
      throw new GitHubRequestError(response.status === 401 ? "github_reconnect" : "provider_down", response.status);
    }
    return await readProviderJson(response);
  } catch (error) {
    if (error instanceof GitHubRequestError) throw error;
    throw new GitHubRequestError(signal.aborted || (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) ? "timeout" : "provider_down");
  }
}

export async function loadGitHubIdentity(accessToken: string | undefined) {
  if (!accessToken) throw new Error("Missing GitHub access token");
  // Strip email and other provider fields; bio is validated later only if consented.
  return userSchema.extend({ avatar_url: z.url({ protocol: /^https$/ }), bio: z.unknown().optional() })
    .parse(await githubGet("user", accessToken));
}

export function githubUserId(accountId: string): string {
  if (!/^[1-9]\d*$/.test(accountId)) throw new Error("Invalid GitHub account ID");
  return `github:${accountId}`;
}

export async function loadGitHubProfile(accountId: string, profile: unknown, accessToken: string, consent: GitHubConsent): Promise<GitHubProfileInput> {
  githubUserId(accountId);
  const user = userSchema.parse(profile);
  if (String(user.id) !== accountId || !accessToken) throw new Error("Invalid GitHub sign-in identity");
  const bio = consent.includes("profile") ? bioSchema.parse(profile).bio : null;

  // shortcut: import the latest 100 public repos and first 100 public orgs; paginate if larger profiles need full coverage.
  const [repoData, orgData] = await Promise.all([
    consent.includes("repos") ? githubGet(`users/${user.login}/repos?type=owner&sort=updated&direction=desc&per_page=100`, accessToken) : [],
    consent.includes("orgs") ? githubGet(`users/${user.login}/orgs?per_page=100`, accessToken) : [],
  ]);
  const repos = z.array(repoSchema).max(100).parse(repoData).filter((repo) => !repo.private);
  return {
    login: user.login, name: user.name, bio,
    repos: repos.map(({ name, description, language, html_url, stargazers_count }) => ({
      name, description, language, html_url, stargazers_count,
    })),
    orgs: z.array(orgSchema).max(100).parse(orgData),
  };
}

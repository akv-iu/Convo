import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { collectGitHubEvidence } from "./github";
import fixtures from "../fixtures/github.json";
import type { RouteBody } from "@/contracts/routes";

const fixture = fixtures[0];
const token = "recorded-github-token";
const owner = "google:101";
const profile = { ...fixture.profile, avatar_url: "https://avatars.githubusercontent.com/u/101" };
const all: RouteBody<"startEnrichment">["github"] = { import: true, bio: true, repos: true, orgs: true };
const fetcher = vi.fn<typeof fetch>();
const json = (value: unknown, status = 200, headers = {}) => Response.json(value, { status, headers });
beforeEach(() => { fetcher.mockReset(); vi.stubGlobal("fetch", fetcher); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("does not read GitHub when import is off, even if category choices remain selected", async () => {
  expect(await collectGitHubEvidence(owner, null, undefined, { ...all, import: false })).toMatchObject({ evidence: [], github: { bio: false, repos: 0, orgs: 0 } });
  expect(fetcher).not.toHaveBeenCalled();
});

it("maps selected public data into evidence without changing profile fields or exposing credentials", async () => {
  fetcher.mockResolvedValueOnce(json({ ...profile, email: "private@example.invalid", private_gists: 5 }))
    .mockResolvedValueOnce(json(fixture.repos)).mockResolvedValueOnce(json(fixture.orgs));
  const result = await collectGitHubEvidence(owner, "101", token, all);
  expect(result.github).toEqual({ bio: true, repos: 2, orgs: 1 });
  expect(result.evidence.map(e => e.kind)).toEqual(["profile_page", "repo", "repo"]);
  expect(result.evidence[0]).toMatchObject({ id: `${owner}:profile_page:github-summary`, source: "github", sourceId: `${owner}:github`,
    title: "GitHub profile", excerpt: "Bio: Builds scheduling tools\nPublic organisations: example-labs", url: "https://github.com/ada-example" });
  expect(result.evidence[1]).toMatchObject({ id: `${owner}:repo:scheduler`, title: "scheduler", excerpt: "Fair task scheduling Language: Rust." });
  expect(JSON.stringify(result)).not.toMatch(/recorded-github-token|private@example.invalid|Private work|private_gists/);
  for (const [url, options] of fetcher.mock.calls) {
    expect(String(url)).not.toContain(token);
    expect(options).toMatchObject({ redirect: "error", headers: { Authorization: `Bearer ${token}` } });
  }
});

it.each(["bio", "repos", "orgs"] as const)("reads only the selected %s category", async category => {
  fetcher.mockResolvedValueOnce(json(profile));
  if (category === "repos") fetcher.mockResolvedValueOnce(json(fixture.repos));
  if (category === "orgs") fetcher.mockResolvedValueOnce(json(fixture.orgs));
  const result = await collectGitHubEvidence(owner, "101", token, { import: true, bio: category === "bio", repos: category === "repos", orgs: category === "orgs" });
  expect(result.github).toEqual({ bio: category === "bio", repos: category === "repos" ? 2 : 0, orgs: category === "orgs" ? 1 : 0 });
  expect(fetcher.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual(["/user", ...(category === "repos" ? ["/users/ada-example/repos"] : []), ...(category === "orgs" ? ["/users/ada-example/orgs"] : [])]);
  if (category !== "bio") expect(JSON.stringify(result)).not.toContain(profile.bio);
  if (category !== "orgs") expect(JSON.stringify(result)).not.toContain("example-labs");
});

it("rejects a token for a different numeric GitHub account before reading repositories or organisations", async () => {
  fetcher.mockResolvedValueOnce(json({ ...profile, id: 999 }));
  await expect(collectGitHubEvidence(owner, "101", token, all)).rejects.toMatchObject({ code: "github_reconnect" });
  expect(fetcher).toHaveBeenCalledOnce();
});

it("uses the current handle after a rename while still verifying the stable numeric identity", async () => {
  fetcher.mockResolvedValueOnce(json({ ...profile, login: "new-handle" })).mockResolvedValueOnce(json([]));
  expect(await collectGitHubEvidence(owner, "101", token, { ...all, bio: false, orgs: false })).toMatchObject({ evidence: [], github: { repos: 0 } });
  expect(String(fetcher.mock.calls[1][0])).toContain("/users/new-handle/repos?");
});

it("reserves one source slot for bio/orgs and retains the highest-star public repositories", async () => {
  const repos = Array.from({ length: 30 }, (_, n) => ({ ...fixture.repos[0], name: `repo-${n}`, stargazers_count: n, html_url: `https://github.com/ada-example/repo-${n}` }));
  fetcher.mockResolvedValueOnce(json(profile)).mockResolvedValueOnce(json(repos)).mockResolvedValueOnce(json([]));
  const result = await collectGitHubEvidence(owner, "101", token, all);
  expect(result.evidence).toHaveLength(20);
  expect(result.github.repos).toBe(19);
  expect(result.evidence[1].title).toBe("repo-29");
  expect(result.evidence.at(-1)?.title).toBe("repo-11");
});

it("returns twenty repositories when no selected profile summary has content", async () => {
  const repos = Array.from({ length: 25 }, (_, n) => ({ ...fixture.repos[0], name: `repo-${n}`, html_url: `https://github.com/ada-example/repo-${n}` }));
  fetcher.mockResolvedValueOnce(json({ ...profile, bio: null })).mockResolvedValueOnce(json(repos));
  expect((await collectGitHubEvidence(owner, "101", token, { ...all, orgs: false })).github).toEqual({ bio: false, repos: 20, orgs: 0 });
});

it("deduplicates and bounds organisation names without claiming more names than the excerpt contains", async () => {
  const orgs = Array.from({ length: 100 }, (_, n) => ({ login: `organisation-${String(n).padStart(25, "0")}` }));
  orgs[99] = orgs[0];
  fetcher.mockResolvedValueOnce(json(profile)).mockResolvedValueOnce(json(orgs));
  const result = await collectGitHubEvidence(owner, "101", token, { ...all, repos: false });
  expect(result.evidence[0].excerpt.length).toBeLessThanOrEqual(3000);
  expect(result.github.orgs).toBeGreaterThan(0);
  const included = result.evidence[0].excerpt.split("Public organisations: ")[1].split(", ");
  expect(included).toHaveLength(result.github.orgs);
  expect(new Set(included).size).toBe(included.length);
});

it("distinguishes an empty selected source from a disabled import", async () => {
  fetcher.mockResolvedValueOnce(json({ ...profile, bio: "  " })).mockResolvedValueOnce(json([])).mockResolvedValueOnce(json([]));
  expect(await collectGitHubEvidence(owner, "101", token, all)).toMatchObject({ evidence: [], reason: "github_nothing_public", github: { bio: false, repos: 0, orgs: 0 } });
});

it.each([[null, token, "github_not_connected"], ["101", undefined, "github_reconnect"], ["../101", token, "invalid_input"]])("rejects an unusable connection before fetching (%s)", async (account, access, code) => {
  await expect(collectGitHubEvidence(owner, account, access, all)).rejects.toMatchObject({ code });
  expect(fetcher).not.toHaveBeenCalled();
});

it.each([
  [401, {}, "github_reconnect"],
  [403, {}, "provider_down"],
  [403, { "x-ratelimit-remaining": "0" }, "rate_limited"],
  [429, { "Retry-After": "120" }, "rate_limited"],
  [500, {}, "provider_down"],
] as const)("sanitizes HTTP %s with reason %s", async (status, headers, code) => {
  fetcher.mockResolvedValueOnce(json({ error: token }, status, headers));
  const error = await collectGitHubEvidence(owner, "101", token, all).catch(e => e);
  expect(error).toMatchObject({ code });
  expect(String(error)).not.toContain(token);
  expect(error).not.toHaveProperty("cause");
});

it("refuses evidence links for a different repository owner", async () => {
  fetcher.mockResolvedValueOnce(json(profile)).mockResolvedValueOnce(json([{ ...fixture.repos[0], html_url: "https://github.com/someone-else/notes" }]));
  await expect(collectGitHubEvidence(owner, "101", token, { ...all, bio: false, orgs: false })).rejects.toMatchObject({ code: "provider_down" });
});

it("ignores an unconsented malformed bio and never retains the account's other private fields", async () => {
  fetcher.mockResolvedValueOnce(json({ ...profile, bio: { private: "secret-bio" }, email: "secret-email" })).mockResolvedValueOnce(json(fixture.repos));
  const result = await collectGitHubEvidence(owner, "101", token, { ...all, bio: false, orgs: false });
  expect(result.github).toEqual({ bio: false, repos: 2, orgs: 0 });
  expect(JSON.stringify(result)).not.toMatch(/secret-bio|secret-email/);
});

it("deduplicates repeated repository evidence before passing it to the worker", async () => {
  fetcher.mockResolvedValueOnce(json(profile)).mockResolvedValueOnce(json([fixture.repos[0], fixture.repos[0]]));
  const result = await collectGitHubEvidence(owner, "101", token, { ...all, bio: false, orgs: false });
  expect(result.github.repos).toBe(1);
  expect(result.evidence).toHaveLength(1);
});

it("rejects invalid consent before any external call", async () => {
  await expect(collectGitHubEvidence(owner, "101", token, { import: true, bio: false, repos: false, orgs: false })).rejects.toMatchObject({ code: "invalid_input", status: 400 });
  expect(fetcher).not.toHaveBeenCalled();
});

it.each(["body-too-large", "malformed-json", "empty-body", "timeout", "transport"])("sanitizes %s before returning to the worker", async failure => {
  if (failure === "body-too-large") fetcher.mockResolvedValueOnce(json(profile, 200, { "Content-Length": "1048577" }));
  if (failure === "malformed-json") fetcher.mockResolvedValueOnce(new Response(`{${token}`, { headers: { "Content-Type": "application/json" } }));
  if (failure === "empty-body") fetcher.mockResolvedValueOnce(new Response(null, { headers: { "Content-Type": "application/json" } }));
  if (failure === "timeout") fetcher.mockRejectedValueOnce(new DOMException(token, "TimeoutError"));
  if (failure === "transport") fetcher.mockRejectedValueOnce(new Error(token));
  const error = await collectGitHubEvidence(owner, "101", token, all).catch(e => e);
  expect(error).toMatchObject({ code: failure === "timeout" ? "timeout" : "provider_down" });
  expect(String(error)).not.toContain(token);
  expect(error).not.toHaveProperty("cause");
});

it("honors primary rate-reset metadata without reading a private error body", async () => {
  fetcher.mockResolvedValueOnce(new Response(token, { status: 403, headers: {
    "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(Math.ceil(Date.now() / 1000) + 300),
  } }));
  const error = await collectGitHubEvidence(owner, "101", token, all).catch(e => e);
  expect(error).toMatchObject({ code: "rate_limited", status: 429 });
  expect(error.retryAfterSeconds).toBeGreaterThanOrEqual(299);
  expect(error.retryAfterSeconds).toBeLessThanOrEqual(301);
});

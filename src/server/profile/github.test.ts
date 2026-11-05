import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { githubUserId, loadGitHubProfile } from "./github";
import fixtures from "./fixtures/github.json";

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("GitHub public data import", () => {
  it.each(fixtures)("imports public data for $profile.login", async (fixture) => {
    fetchMock.mockResolvedValueOnce(Response.json(fixture.repos)).mockResolvedValueOnce(Response.json(fixture.orgs));
    const result = await loadGitHubProfile(String(fixture.profile.id), fixture.profile, "test-access-token");
    expect(result).toEqual({
      login: fixture.profile.login, name: fixture.profile.name, bio: fixture.profile.bio,
      repos: fixture.repos.filter((r) => !r.private).map((repo) => ({
        name: repo.name, description: repo.description, language: repo.language,
        html_url: repo.html_url, stargazers_count: repo.stargazers_count,
      })),
      orgs: fixture.orgs,
    });
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      `https://api.github.com/users/${fixture.profile.login}/repos?type=owner&sort=updated&direction=desc&per_page=100`,
      `https://api.github.com/users/${fixture.profile.login}/orgs?per_page=100`,
    ]);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init).toMatchObject({ cache: "no-store", redirect: "error", headers: { Authorization: "Bearer test-access-token" } });
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("rejects an identity mismatch before making external requests", async () => {
    await expect(loadGitHubProfile("999", fixtures[0].profile, "secret")).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([null, { id: 101, login: "../../other", name: null, bio: null }])("rejects malformed OAuth data", async (profile) => {
    await expect(loadGitHubProfile("101", profile, "secret")).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([401, 403, 429, 500])("rejects HTTP %i without leaking the response body or token", async (status) => {
    fetchMock.mockResolvedValue(new Response("sensitive body", { status }));
    const error = await loadGitHubProfile("101", fixtures[0].profile, "secret").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toMatch(/sensitive body|secret/);
    expect(String(error)).toContain(String(status));
  });

  it("rejects malformed repository data instead of saving an empty profile", async () => {
    fetchMock.mockResolvedValueOnce(Response.json([{ name: "incomplete" }])).mockResolvedValueOnce(Response.json([]));
    await expect(loadGitHubProfile("101", fixtures[0].profile, "secret")).rejects.toThrow();
  });

  it.each(["javascript:alert(1)", "https://example.test/repo"])("rejects untrusted evidence URL %s", async (html_url) => {
    fetchMock.mockResolvedValueOnce(Response.json([{ ...fixtures[0].repos[0], html_url }])).mockResolvedValueOnce(Response.json([]));
    await expect(loadGitHubProfile("101", fixtures[0].profile, "secret")).rejects.toThrow();
  });

  it("rejects malformed organisations rather than silently dropping them", async () => {
    fetchMock.mockResolvedValueOnce(Response.json([])).mockResolvedValueOnce(Response.json([{ login: 42 }]));
    await expect(loadGitHubProfile("101", fixtures[0].profile, "secret")).rejects.toThrow();
  });

  it("rejects failed requests without exposing their error details", async () => {
    fetchMock.mockRejectedValue(new Error("network error containing secret"));
    const error = await loadGitHubProfile("101", fixtures[0].profile, "secret").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain("secret");
  });
});

describe("GitHub identity", () => {
  it("uses the immutable account ID rather than a login or random session ID", () => {
    expect(githubUserId("101")).toBe("github:101");
  });
  it.each(["", "ada-example", "../101", "0"])("rejects invalid account ID %s", (id) => {
    expect(() => githubUserId(id)).toThrow();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { githubUserId, loadGitHubIdentity, loadGitHubProfile } from "./github";
import fixtures from "./fixtures/github.json";
import { consentSources } from "./consent";

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("GitHub public data import", () => {
  it.each(fixtures)("imports public data for $profile.login", async (fixture) => {
    fetchMock.mockResolvedValueOnce(Response.json(fixture.repos)).mockResolvedValueOnce(Response.json(fixture.orgs));
    const result = await loadGitHubProfile(String(fixture.profile.id), fixture.profile, "test-access-token", consentSources);
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
    await expect(loadGitHubProfile("999", fixtures[0].profile, "secret", consentSources)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([null, { id: 101, login: "../../other", name: null, bio: null }])("rejects malformed OAuth data", async (profile) => {
    await expect(loadGitHubProfile("101", profile, "secret", consentSources)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([401, 403, 429, 500])("rejects HTTP %i without leaking the response body or token", async (status) => {
    fetchMock.mockResolvedValue(new Response("sensitive body", { status }));
    const error = await loadGitHubProfile("101", fixtures[0].profile, "secret", consentSources).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toMatch(/sensitive body|secret/);
    expect(String(error)).toContain(String(status));
  });

  it("rejects malformed repository data instead of saving an empty profile", async () => {
    fetchMock.mockResolvedValueOnce(Response.json([{ name: "incomplete" }])).mockResolvedValueOnce(Response.json([]));
    await expect(loadGitHubProfile("101", fixtures[0].profile, "secret", consentSources)).rejects.toThrow();
  });

  it.each(["javascript:alert(1)", "https://example.test/repo"])("rejects untrusted evidence URL %s", async (html_url) => {
    fetchMock.mockResolvedValueOnce(Response.json([{ ...fixtures[0].repos[0], html_url }])).mockResolvedValueOnce(Response.json([]));
    await expect(loadGitHubProfile("101", fixtures[0].profile, "secret", consentSources)).rejects.toThrow();
  });

  it("rejects malformed organisations rather than silently dropping them", async () => {
    fetchMock.mockResolvedValueOnce(Response.json([])).mockResolvedValueOnce(Response.json([{ login: 42 }]));
    await expect(loadGitHubProfile("101", fixtures[0].profile, "secret", consentSources)).rejects.toThrow();
  });

  it("rejects failed requests without exposing their error details", async () => {
    fetchMock.mockRejectedValue(new Error("network error containing secret"));
    const error = await loadGitHubProfile("101", fixtures[0].profile, "secret", consentSources).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain("secret");
  });
});

describe("GitHub identity", () => {
  it.each([null, "private@example.invalid"])("never fetches emails or retains unneeded provider fields (email=%s)", async (email) => {
    const identity = { ...fixtures[0].profile, avatar_url: "https://avatars.githubusercontent.com/u/101" };
    fetchMock.mockResolvedValueOnce(Response.json({ ...identity, email, private_gists: 42, location: "Ignored" }));
    expect(await loadGitHubIdentity("test-token")).toEqual(identity);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.github.com/user");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: "no-store", redirect: "error" });
  });

  it("rejects missing credentials before fetching identity", async () => {
    await expect(loadGitHubIdentity(undefined)).rejects.toThrow("Missing GitHub access token");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects failed identity requests without an email fallback", async () => {
    fetchMock.mockResolvedValueOnce(new Response("private failure", { status: 401 }));
    await expect(loadGitHubIdentity("test-token")).rejects.toThrow("GitHub profile request failed (401)");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects malformed identity responses", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ login: "no-id" }));
    await expect(loadGitHubIdentity("test-token")).rejects.toThrow();
  });
  it("uses the immutable account ID rather than a login or random session ID", () => {
    expect(githubUserId("101")).toBe("github:101");
  });
  it.each(["", "ada-example", "../101", "0"])("rejects invalid account ID %s", (id) => {
    expect(() => githubUserId(id)).toThrow();
  });
});

describe("consent-limited GitHub import", () => {
  const combinations = Array.from({ length: 8 }, (_, mask) => consentSources.filter((_, i) => mask & (1 << i)));

  it.each(combinations.map((consent) => ({ consent })))("fetches and returns only selected sources: $consent", async ({ consent }) => {
    const fixture = fixtures[0];
    fetchMock.mockImplementation(async (url) => Response.json(String(url).includes("/repos?") ? fixture.repos : fixture.orgs));
    const result = await loadGitHubProfile("101", fixture.profile, "test-token", consent);
    expect(result.login).toBe(fixture.profile.login);
    expect(result.name).toBe(fixture.profile.name);
    expect(result.bio).toBe(consent.includes("profile") ? fixture.profile.bio : null);
    expect(result.repos).toHaveLength(consent.includes("repos") ? fixture.repos.filter(r => !r.private).length : 0);
    expect(result.orgs).toEqual(consent.includes("orgs") ? fixture.orgs : []);
    expect(fetchMock.mock.calls.map(([url]) => new URL(String(url)).pathname.split("/").at(-1))).toEqual(
      [consent.includes("repos") ? "repos" : null, consent.includes("orgs") ? "orgs" : null].filter(Boolean),
    );
  });

  it("does not consume an unconsented bio or call optional endpoints", async () => {
    const profile = { ...fixtures[0].profile, bio: { unexpected: "private data" } };
    const result = await loadGitHubProfile("101", profile, "test-token", []);
    expect(result.bio).toBeNull();
    expect(result.repos).toEqual([]);
    expect(result.orgs).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still validates a consented bio before making external requests", async () => {
    await expect(loadGitHubProfile("101", { ...fixtures[0].profile, bio: 42 }, "test-token", consentSources)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still rejects identity mismatches when all optional sources are declined", async () => {
    await expect(loadGitHubProfile("999", fixtures[0].profile, "test-token", [])).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

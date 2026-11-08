import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Account, Profile } from "next-auth";
import { Auth, skipCSRFCheck } from "@auth/core";
import type { OAuthConfig } from "@auth/core/providers";
import type { GitHubProfile } from "next-auth/providers/github";
import { DEMO_USER_A } from "@/contracts/fixtures";
import fixtures from "./fixtures/github.json";

const { initialize, auth, cookies, cookieGet, config } = vi.hoisted(() => ({
  initialize: vi.fn(), auth: vi.fn(), cookies: vi.fn(), cookieGet: vi.fn(), config: { fakeApi: false },
}));
vi.mock("next/headers", () => ({ cookies }));
vi.mock("@/server/config", () => ({ config }));
vi.mock("./persistence", () => ({ initializeGitHubProfile: initialize }));
vi.mock("next-auth", () => ({ default: vi.fn(() => ({ handlers: {}, auth, signIn: vi.fn(), signOut: vi.fn() })) }));
import { authOptions, getUserId } from "@/server/auth";

const options = authOptions();
const callbacks = options.callbacks!;
const account: Account = { provider: "github", type: "oauth", providerAccountId: "101", access_token: "private-token" };
// GitHub's raw OAuth profile has a numeric ID despite Auth.js's generic Profile type.
const profile = fixtures[0].profile as unknown as Profile;
const signInArgs = { user: { id: "random-auth-id" }, account, profile };

beforeEach(() => {
  config.fakeApi = false;
  initialize.mockReset().mockResolvedValue(undefined);
  auth.mockReset();
  cookieGet.mockReset().mockReturnValue({ value: "profile,repos,orgs" });
  cookies.mockReset().mockResolvedValue({ get: cookieGet });
});
afterEach(() => { config.fakeApi = true; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("GitHub sign-in integration", () => {
  it("wires the provider to the identity-only loader and excludes email from its user mapping", async () => {
    const raw = { ...fixtures[0].profile, avatar_url: "https://avatars.githubusercontent.com/u/101", email: "private@example.invalid" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(raw)));
    const provider = options.providers[0] as OAuthConfig<GitHubProfile>;
    const userinfo = provider.options?.userinfo;
    if (!userinfo || typeof userinfo === "string" || !userinfo.request) throw new Error("Missing identity override");
    const identity = await userinfo.request({ tokens: { access_token: "test-token" } });
    expect(identity).not.toHaveProperty("email");
    expect(fetch).toHaveBeenCalledOnce();
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("https://api.github.com/user");
    const user = await provider.options!.profile!(raw as GitHubProfile, { access_token: "test-token" });
    expect(user).toEqual({ id: "101", name: "Ada Example", image: raw.avatar_url });
  });
  it("generates a GitHub authorization URL with no extra scopes and keeps PKCE protection", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Unexpected live request")));
    const provider = options.providers[0] as OAuthConfig<GitHubProfile>;
    const response = await Auth(new Request("http://localhost:3000/api/auth/signin/github", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "callbackUrl=http%3A%2F%2Flocalhost%3A3000",
    }), {
      ...options, secret: "test-secret-not-a-real-credential", basePath: "/api/auth", skipCSRFCheck,
      providers: [{ ...provider, options: { ...provider.options, clientId: "test-id", clientSecret: "test-secret" } }],
    });
    expect(response.status).toBe(302);
    const redirect = new URL(response.headers.get("location")!);
    expect(redirect.origin).toBe("https://github.com");
    expect(redirect.searchParams.get("scope")).toBe("");
    expect(redirect.searchParams.get("client_id")).toBe("test-id");
    expect(redirect.searchParams.get("code_challenge")).toBeTruthy();
    expect(redirect.searchParams.get("code_challenge_method")).toBe("S256");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("persists the profile before accepting a real sign-in", async () => {
    expect(await callbacks.signIn?.(signInArgs)).toBe(true);
    expect(cookieGet).toHaveBeenCalledWith("convo_consent");
    expect(initialize).toHaveBeenCalledWith("101", fixtures[0].profile, "private-token", ["profile", "repos", "orgs"]);
  });

  it.each([
    { value: undefined, expected: [] },
    { value: "", expected: [] },
    { value: "repos,unknown", expected: ["repos"] },
    { value: "orgs", expected: ["orgs"] },
  ])("passes only the callback request's consent ($value)", async ({ value, expected }) => {
    cookieGet.mockReturnValue(value === undefined ? undefined : { value });
    expect(await callbacks.signIn?.(signInArgs)).toBe(true);
    expect(initialize).toHaveBeenCalledWith("101", fixtures[0].profile, "private-token", expected);
  });

  it("denies import if the request's consent cannot be read", async () => {
    cookies.mockRejectedValueOnce(new Error("private-request-details"));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await callbacks.signIn?.(signInArgs)).toBe(false);
    expect(initialize).not.toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain("private-request-details");
  });

  it("keeps concurrent sign-ins' choices separate and does not reuse a previous grant", async () => {
    cookies.mockResolvedValueOnce({ get: () => ({ value: "repos" }) })
      .mockResolvedValueOnce({ get: () => ({ value: "orgs" }) })
      .mockResolvedValueOnce({ get: () => undefined });
    expect(await Promise.all([callbacks.signIn!(signInArgs), callbacks.signIn!(signInArgs)])).toEqual([true, true]);
    expect(await callbacks.signIn?.(signInArgs)).toBe(true);
    expect(initialize.mock.calls.map(call => call[3])).toEqual([["repos"], ["orgs"], []]);
  });

  it("rejects missing credentials without attempting an import", async () => {
    expect(await callbacks.signIn?.({ ...signInArgs, account: { ...account, access_token: undefined } })).toBe(false);
    expect(initialize).not.toHaveBeenCalled();
  });

  it("denies sign-in on import failure without logging secrets", async () => {
    initialize.mockRejectedValueOnce(new Error("private-token database-password"));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await callbacks.signIn?.(signInArgs)).toBe(false);
    expect(log).toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/private-token|database-password/);
  });

  it("keeps fake mode independent of GitHub and Postgres", async () => {
    config.fakeApi = true;
    expect(await callbacks.signIn?.(signInArgs)).toBe(true);
    expect(initialize).not.toHaveBeenCalled();
    expect(await getUserId(new Request("https://example.test/api/me"))).toBe(DEMO_USER_A);
    expect(await getUserId(new Request("https://example.test/api/me", { headers: { "x-demo-user": "demo-b" } }))).toBe("demo-b");
    expect(auth).not.toHaveBeenCalled();
    expect(cookies).not.toHaveBeenCalled();
  });

  it("uses one stable ID across separate sign-ins and login renames", async () => {
    const first = await callbacks.jwt!({ ...signInArgs, token: { sub: "random-1" } });
    const next = await callbacks.jwt!({ ...signInArgs, profile: { ...profile, login: "renamed-example" }, token: { sub: "random-2" } });
    expect(first?.sub).toBe("github:101");
    expect(next?.sub).toBe("github:101");
    expect(next?.githubLogin).toBe("renamed-example");
  });

  it("keeps the provider token in the encrypted JWT, not the browser-readable session", async () => {
    const token = await callbacks.jwt!({ ...signInArgs, token: { sub: "random", githubToken: "old-secret" } });
    expect(token?.githubToken).toBe("private-token");
    const session = await callbacks.session!({
      session: { user: { name: "Ada" }, expires: "2030-01-01T00:00:00Z" }, token,
    } as Parameters<NonNullable<typeof callbacks.session>>[0]);
    expect(JSON.stringify(session)).not.toMatch(/private-token|old-secret|githubToken/);
    expect(session.user?.id).toBe("github:101");
  });

  it("keeps the stable identity on session refresh without repeating the import", async () => {
    const token = await callbacks.jwt!({ token: { sub: "github:101", email: "legacy@example.invalid" }, user: { id: "github:101" }, account: null });
    expect(token?.sub).toBe("github:101");
    expect(token).not.toHaveProperty("email");
    expect(initialize).not.toHaveBeenCalled();
    const session = await callbacks.session!({
      session: { user: { name: "Ada" }, expires: "2030-01-01T00:00:00Z" }, token,
    } as Parameters<NonNullable<typeof callbacks.session>>[0]);
    expect(session.user?.id).toBe("github:101");
    expect(session).not.toHaveProperty("githubToken");
  });

  it("ignores demo headers in real mode and requires an authenticated session", async () => {
    auth.mockResolvedValueOnce(null).mockResolvedValueOnce({ user: { id: "github:101" } });
    const req = new Request("https://example.test/api/me", { headers: { "x-demo-user": "someone-else" } });
    expect(await getUserId(req)).toBeNull();
    expect(await getUserId(req)).toBe("github:101");
  });
});

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Account, Profile } from "next-auth";
import { NextRequest } from "next/server";
import { Auth, skipCSRFCheck, type AuthConfig } from "@auth/core";
import { getToken } from "next-auth/jwt";
import type { OAuthConfig } from "@auth/core/providers";
import type { GitHubProfile } from "next-auth/providers/github";

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), refresh: vi.fn(), complete: vi.fn(), clear: vi.fn(), cookieGet: vi.fn(), get: vi.fn(),
  runtime: { fakeApi: false, profileEnrichmentEnabled: true } }));
vi.mock("@/server/config", () => ({ config: mocks.runtime }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: mocks.cookieGet }) }));
vi.mock("./identities", async original => ({ ...await original<typeof import("./identities")>(), resolveIdentity: mocks.resolve, refreshGitHubHandle: mocks.refresh }));
vi.mock("./connection", () => ({ completeGitHubConnection: mocks.complete, clearConnection: mocks.clear,  }));
vi.mock("next-auth", () => ({ default: () => ({ handlers: { GET: mocks.get, POST: mocks.get }, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }) }));
import { authOptions, handlers } from "@/server/auth";

const github: Account = { provider: "github", type: "oauth", providerAccountId: "101", access_token: "github-private" };
const google: Account = { provider: "google", type: "oidc", providerAccountId: "900", access_token: "google-private", id_token: "google-id-token" };
const ghProfile = { id: 101, login: "new-login", name: "Provider Name", avatar_url: "https://example.invalid/avatar" } as unknown as Profile;
const session = { sub: "google:900", signInProvider: "google", sessionId: "stable-session", jti: "jwt-nonce" };
const options = () => authOptions(new Request("https://app.invalid/api/auth/callback/github?state=verified-state"));
beforeEach(() => {
  mocks.runtime.profileEnrichmentEnabled = true; mocks.runtime.fakeApi = false;
  mocks.resolve.mockReset().mockResolvedValue("google:900"); mocks.refresh.mockReset().mockResolvedValue(undefined);
  mocks.complete.mockReset().mockResolvedValue(null); mocks.clear.mockReset().mockResolvedValue(undefined); mocks.cookieGet.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected provider request"); }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("adds Google only behind the feature flag and maps no optional provider fields", async () => {
  const providers = options().providers as OAuthConfig<Profile>[];
  const googleProvider = providers[1];
  expect(googleProvider.options?.authorization).toEqual({ params: { scope: "openid profile" } });
  expect(googleProvider.options?.checks).toEqual(["pkce", "state", "nonce"]);
  expect(await googleProvider.options?.profile?.({ sub: "900", name: "Private Name", email: "private@example.invalid", picture: "https://example.invalid/picture" }, {}))
    .toEqual({ id: "900" });
  mocks.runtime.profileEnrichmentEnabled = false;
  expect(options().providers).toHaveLength(1);
});

it("authenticates Google by subject and never stores Google's credentials as a GitHub token", async () => {
  const callbacks = options().callbacks!;
  const user = { id: "provider-random-id" };
  expect(await callbacks.signIn!({ user, account: google, profile: { sub: "900", email: "ignored@example.invalid" } })).toBe(true);
  expect(mocks.resolve).toHaveBeenCalledWith("google", "900", null);
  const token = await callbacks.jwt!({ token: { githubToken: "old-gh", githubLogin: "old", email: "old", name: "old", picture: "old" }, user, account: google, profile: { sub: "900" } });
  expect(token).toMatchObject({ sub: "google:900", signInProvider: "google" });
  expect(token?.sessionId).toEqual(expect.any(String));
  expect(token).not.toHaveProperty("githubToken");
  expect(JSON.stringify(token)).not.toMatch(/google-private|google-id-token|ignored@example/);
  expect(mocks.refresh).not.toHaveBeenCalled();
});

it("resolves GitHub to its linked Google account without importing repositories or changing provider ownership", async () => {
  const callbacks = options().callbacks!;
  const user = { id: "random" };
  expect(await callbacks.signIn!({ user, account: github, profile: ghProfile })).toBe(true);
  expect(mocks.resolve).toHaveBeenCalledWith("github", "101", "new-login");
  const token = await callbacks.jwt!({ token: {}, user, account: github, profile: ghProfile });
  expect(token).toMatchObject({ sub: "google:900", signInProvider: "github", githubToken: "github-private", githubLogin: "new-login" });
  expect(fetch).not.toHaveBeenCalled();
});

it("keeps the current owner, original sign-in provider and session binding during explicit GitHub linking", async () => {
  mocks.complete.mockResolvedValue(session);
  const callbacks = options().callbacks!;
  const user = { id: "github-provider-id" };
  expect(await callbacks.signIn!({ user, account: github, profile: ghProfile })).toBe(true);
  expect(mocks.complete).toHaveBeenCalledWith("verified-state", "101", ghProfile);
  expect(mocks.resolve).not.toHaveBeenCalled();
  const token = await callbacks.jwt!({ token: {}, user, account: github, profile: ghProfile });
  expect(token).toMatchObject({ sub: "google:900", signInProvider: "google", sessionId: "stable-session", githubToken: "github-private" });
  const browser = await callbacks.session!({ session: { user: { email: "legacy@example.invalid", image: "old" }, expires: "2030-01-01" }, token } as Parameters<NonNullable<typeof callbacks.session>>[0]);
  expect(browser).toEqual({ user: { id: "google:900" }, expires: "2030-01-01" });
});

it.each(["github_linked_elsewhere", "github_reconnect", "database-secret"])("rejects a failed connection without switching sessions: %s", async code => {
  mocks.complete.mockRejectedValue(Object.assign(new Error("secret-token"), { code }));
  const result = await options().callbacks!.signIn!({ user: { id: "github-provider-id" }, account: github, profile: ghProfile });
  expect(result).toBe(`/signin/sources?reason=${code === "database-secret" ? "provider_down" : code}`);
  expect(mocks.resolve).not.toHaveBeenCalled();
  expect(mocks.refresh).not.toHaveBeenCalled();
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toMatch(/secret-token|database-secret/);
});

it("rejects mismatched provider subjects before saving anything", async () => {
  const callbacks = options().callbacks!;
  expect(await callbacks.signIn!({ user: { id: "random" }, account: google, profile: { sub: "901" } })).toBe("/signin/sources?reason=provider_down");
  expect(await callbacks.signIn!({ user: { id: "random" }, account: github, profile: { ...ghProfile, id: 102 } as unknown as Profile })).toBe("/signin/sources?reason=provider_down");
  expect(mocks.resolve).not.toHaveBeenCalled();
});

it("ignores session-update client claims and keeps providers private on refresh", async () => {
  const callbacks = options().callbacks!;
  const token = await callbacks.jwt!({ token: { ...session, githubToken: "github-private", email: "legacy", name: "legacy", picture: "legacy" },
    user: { id: session.sub }, trigger: "update", session: { sub: "victim", signInProvider: "github", githubToken: "forged" } });
  expect(token).toMatchObject({ ...session, githubToken: "github-private" });
  expect(token).not.toHaveProperty("email"); expect(token).not.toHaveProperty("picture");
});

it("allows only same-origin return URLs", async () => {
  const redirect = options().callbacks!.redirect!;
  expect(await redirect({ url: "/onboarding", baseUrl: "https://app.invalid" })).toBe("https://app.invalid/signin/sources");
  expect(await redirect({ url: "https://evil.invalid/", baseUrl: "https://app.invalid" })).toBe("https://app.invalid/signin/sources");
  expect(await redirect({ url: "/signin/sources?reason=github_linked_elsewhere&other=discarded", baseUrl: "https://app.invalid" }))
    .toBe("https://app.invalid/signin/sources?reason=github_linked_elsewhere");
  expect(await redirect({ url: "/signin/sources?reason=untrusted", baseUrl: "https://app.invalid" })).toBe("https://app.invalid/signin/sources");
});

it.each([false, true])("normalizes a denied provider callback after Auth.js processes it (connecting=%s)", async connecting => {
  mocks.cookieGet.mockReturnValue(connecting ? { value: "attempt-id" } : undefined);
  mocks.get.mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://app.invalid/api/auth/enrichment-error?error=OAuthCallbackError" } }));
  const result = await handlers.GET(new NextRequest("https://app.invalid/api/auth/callback/github?error=access_denied&state=opaque"));
  expect(mocks.get).toHaveBeenCalled();
  expect(result.headers.get("location")).toBe(`https://app.invalid/signin/sources?reason=${connecting ? "github_connect_cancelled" : "sign_in_cancelled"}`);
});

it.each([false, true])("completes an actual Auth.js callback and preserves refusal reasons (refused=%s)", async refused => {
  if (refused) mocks.complete.mockRejectedValue(Object.assign(new Error("Private details"), { code: "github_linked_elsewhere" }));
  else mocks.complete.mockResolvedValue(session);
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async input => {
    const url = String(input);
    if (url.includes("access_token")) return Response.json({ access_token: "github-private", token_type: "bearer", scope: "" });
    if (url === "https://api.github.com/user") return Response.json(ghProfile);
    throw new Error("Unexpected URL");
  }));
  const provider = options().providers[0] as OAuthConfig<GitHubProfile>;
  const base = { secret: "recorded-only-test-secret", basePath: "/api/auth", trustHost: true, skipCSRFCheck,
    providers: [{ ...provider, options: { ...provider.options, clientId: "recorded-id", clientSecret: "recorded-secret" } }] } satisfies AuthConfig;
  const authorize = await Auth(new Request("https://app.invalid/api/auth/signin/github", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "callbackUrl=https%3A%2F%2Fapp.invalid%2Fsignin",
  }), { ...options(), ...base });
  const state = new URL(authorize.headers.get("location")!).searchParams.get("state")!;
  const cookie = authorize.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  const callbackUrl = `https://app.invalid/api/auth/callback/github?code=recorded-code&state=${encodeURIComponent(state)}`;
  const response = await Auth(new Request(callbackUrl, { headers: { cookie } }), { ...authOptions(new Request(callbackUrl)), ...base });
  expect(response.status).toBe(302);
  if (refused) {
    expect(response.headers.get("location")).toBe("https://app.invalid/signin/sources?reason=github_linked_elsewhere");
    expect(response.headers.getSetCookie().some(cookie => cookie.includes("authjs.session-token"))).toBe(false);
    return;
  }
  expect(response.headers.get("location")).toBe("https://app.invalid/signin/sources");
  const sessionCookie = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  const token = await getToken({ req: { headers: { cookie: sessionCookie } }, secret: base.secret, secureCookie: true });
  expect(token).toMatchObject({ sub: "google:900", githubToken: "github-private", signInProvider: "google" });
});

it("generates Google's minimal-scope URL with state, PKCE and nonce using recorded discovery", async () => {
  vi.stubGlobal("fetch",vi.fn<typeof fetch>(async()=>Response.json({
    issuer:"https://accounts.google.com",authorization_endpoint:"https://accounts.google.com/o/oauth2/v2/auth",
    token_endpoint:"https://oauth2.googleapis.com/token",jwks_uri:"https://www.googleapis.com/oauth2/v3/certs",
    response_types_supported:["code"],subject_types_supported:["public"],id_token_signing_alg_values_supported:["RS256"],code_challenge_methods_supported:["S256"],
  })));
  const provider=options().providers[1] as OAuthConfig<Profile>;
  const response=await Auth(new Request("https://app.invalid/api/auth/signin/google",{
    method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:"callbackUrl=https%3A%2F%2Fapp.invalid%2Fsignin",
  }),{...options(),secret:"recorded-only-secret",basePath:"/api/auth",skipCSRFCheck,
    providers:[{...provider,options:{...provider.options,clientId:"recorded-id",clientSecret:"recorded-secret"}}],
  });
  const url=new URL(response.headers.get("location")!);
  expect(url.searchParams.get("scope")).toBe("openid profile");
  expect(url.searchParams.get("state")).toBeTruthy();expect(url.searchParams.get("nonce")).toBeTruthy();
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
});

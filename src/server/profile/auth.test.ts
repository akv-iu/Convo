import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Account, NextAuthConfig, Profile } from "next-auth";
import NextAuth from "next-auth";
import { DEMO_USER_A } from "@/contracts/fixtures";
import fixtures from "./fixtures/github.json";

const { initialize, auth, config } = vi.hoisted(() => ({ initialize: vi.fn(), auth: vi.fn(), config: { fakeApi: false } }));
vi.mock("@/server/config", () => ({ config }));
vi.mock("./persistence", () => ({ initializeGitHubProfile: initialize }));
vi.mock("next-auth", () => ({ default: vi.fn(() => ({ handlers: {}, auth, signIn: vi.fn(), signOut: vi.fn() })) }));
import { getUserId } from "@/server/auth";

const options = vi.mocked(NextAuth).mock.calls[0][0] as NextAuthConfig;
const callbacks = options.callbacks!;
const account: Account = { provider: "github", type: "oauth", providerAccountId: "101", access_token: "private-token" };
// GitHub's raw OAuth profile has a numeric ID despite Auth.js's generic Profile type.
const profile = fixtures[0].profile as unknown as Profile;
const signInArgs = { user: { id: "random-auth-id" }, account, profile };

beforeEach(() => {
  config.fakeApi = false;
  initialize.mockReset().mockResolvedValue(undefined);
  auth.mockReset();
});
afterEach(() => { config.fakeApi = true; vi.restoreAllMocks(); });

describe("GitHub sign-in integration", () => {
  it("persists the profile before accepting a real sign-in", async () => {
    expect(await callbacks.signIn?.(signInArgs)).toBe(true);
    expect(initialize).toHaveBeenCalledWith("101", fixtures[0].profile, "private-token");
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
    const token = await callbacks.jwt!({ token: { sub: "github:101" }, user: { id: "github:101" }, account: null });
    expect(token?.sub).toBe("github:101");
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

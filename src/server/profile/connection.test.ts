import { createHash } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { encode } from "next-auth/jwt";

const mocks = vi.hoisted(() => ({ query: vi.fn(), headers: vi.fn(), get: vi.fn(), set: vi.fn() }));
vi.mock("@neondatabase/serverless", async original => ({ ...await original<typeof import("@neondatabase/serverless")>(), neon: () => ({ query: mocks.query }) }));
vi.mock("next/headers", () => ({ headers: mocks.headers, cookies: async () => ({ get: mocks.get, set: mocks.set }) }));
import { accountState, authorizeGitHubConnection, beginGitHubConnection, clearConnection, completeGitHubConnection, currentToken, LINK_COOKIE } from "./connection";

const secret = "recorded-secret-not-a-provider-credential";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const attempt = { id: "attempt-id", userId: "google:900", sessionHash: hash("google:900:stable"), stateHash: hash("oauth-state") as string | null,
  expiresAt: new Date(Date.now()+600_000), consumedAt: null as Date | null };
function stored(changes: Partial<typeof attempt> = {}) {
  const value = { ...attempt, ...changes };
  return { rows: [[value.id, value.userId, value.sessionHash, value.stateHash, value.expiresAt.toISOString(), value.consumedAt?.toISOString() ?? null]] };
}
async function session(owner = "google:900", secure = false, sessionId = "stable") {
  const cookieName = `${secure ? "__Secure-" : ""}authjs.session-token`;
  const token = await encode({ secret, salt: cookieName, token: { sub: owner, sessionId, signInProvider: "google" } });
  mocks.headers.mockResolvedValue(new Headers({ cookie: `${cookieName}=${token}` }));
  return token;
}
beforeEach(async () => {
  vi.stubEnv("AUTH_SECRET",secret); vi.stubEnv("DATABASE_URL","postgresql://unused:unused@example.invalid/unused");
  mocks.query.mockReset(); mocks.headers.mockReset(); mocks.get.mockReset().mockReturnValue({ value: attempt.id }); mocks.set.mockReset();
  await session();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

it.each([false,true])("decodes only the browser's authenticated cookie (secure=%s)", async secure => {
  const token = await session("google:900", secure);
  expect(await currentToken()).toMatchObject({ sub:"google:900", sessionId:"stable" });
  mocks.headers.mockResolvedValue(new Headers({ authorization:`Bearer ${token}` }));
  expect(await currentToken()).toBeNull();
});

it("creates a ten-minute owner/session-bound attempt with a private cookie and same-site path", async () => {
  mocks.query.mockResolvedValue({rows:[]});
  const result = await beginGitHubConnection("google:900");
  expect(result).toEqual({status:"redirect",path:`/api/auth/connect/github?token=${mocks.set.mock.calls[0][1]}`});
  const [statement, params] = mocks.query.mock.calls[0];
  expect(statement).toContain("interval '10 minutes'");
  expect(params).toContain(attempt.sessionHash);
  expect(mocks.set).toHaveBeenCalledWith(LINK_COOKIE, expect.any(String), expect.objectContaining({httpOnly:true,sameSite:"lax",path:"/api/",maxAge:600}));
  expect(JSON.stringify(mocks.query.mock.calls)).not.toMatch(/Bearer|access_token|refresh_token/);
});

it("rejects another owner before creating any attempt", async () => {
  await expect(beginGitHubConnection("victim")).rejects.toMatchObject({code:"github_reconnect"});
  expect(mocks.query).not.toHaveBeenCalled();
});

it.each([null, "wrong-token"])("refuses a bare or forged entry token even with the pending cookie: %s", async token => {
  const start = vi.fn();
  await expect(authorizeGitHubConnection(start, token)).rejects.toMatchObject({code:"github_reconnect"});
  expect(start).not.toHaveBeenCalled();
  expect(mocks.query).not.toHaveBeenCalled();
});

it("does not start another authorization after the entry token was consumed", async () => {
  mocks.query.mockResolvedValue({rows:[]});
  const start = vi.fn();
  await expect(authorizeGitHubConnection(start, attempt.id)).rejects.toMatchObject({code:"github_reconnect"});
  expect(start).not.toHaveBeenCalled();
});

it("binds the authorization state to the existing attempt exactly once", async () => {
  mocks.query.mockResolvedValueOnce(stored({stateHash:null})).mockResolvedValueOnce({rows:[[attempt.id]]});
  const url = "https://github.com/login/oauth/authorize?state=oauth-state&scope=&code_challenge_method=S256&code_challenge=recorded";
  expect(await authorizeGitHubConnection(async () => url, attempt.id)).toBe(url);
  expect(mocks.query.mock.calls[1][1]).toContain(hash("oauth-state"));
});

it.each([
  "https://evil.invalid/?state=oauth-state&scope=&code_challenge_method=S256",
  "https://github.com/login/oauth/authorize?state=oauth-state&scope=repo&code_challenge_method=S256",
  "https://github.com/login/oauth/authorize?state=oauth-state&scope=",
])("refuses an unexpected authorization redirect: %s", async url => {
  mocks.query.mockResolvedValueOnce(stored({stateHash:null}));
  await expect(authorizeGitHubConnection(async () => url, attempt.id)).rejects.toMatchObject({code:"provider_down"});
  expect(mocks.query).toHaveBeenCalledOnce();
});

it("refuses missing or superseded attempt cookies without starting OAuth", async () => {
  mocks.get.mockReturnValue(undefined);
  const start=vi.fn();
  await expect(authorizeGitHubConnection(start, attempt.id)).rejects.toMatchObject({code:"github_reconnect"});
  expect(start).not.toHaveBeenCalled();
  mocks.get.mockReturnValue({value:attempt.id}); mocks.query.mockResolvedValue({rows:[]});
  await expect(authorizeGitHubConnection(start, attempt.id)).rejects.toMatchObject({code:"github_reconnect"});
  expect(start).not.toHaveBeenCalled();
});

it("detects a lost attempt cookie from OAuth state rather than silently signing into GitHub", async () => {
  mocks.get.mockReturnValue(undefined); mocks.query.mockResolvedValueOnce(stored());
  await expect(completeGitHubConnection("oauth-state","101",{id:101,login:"renamed"})).rejects.toMatchObject({code:"github_reconnect"});
  expect(mocks.query).toHaveBeenCalledOnce();
});

it.each([
  {sessionHash:hash("other-session")}, {consumedAt:new Date()}, {expiresAt:new Date(Date.now()-1)},
])("rejects stale, replayed and mismatched sessions before claiming identity", async changes => {
  mocks.query.mockResolvedValueOnce(stored(changes));
  await expect(completeGitHubConnection("oauth-state","101",{id:101,login:"renamed"})).rejects.toMatchObject({code:"github_reconnect"});
  expect(mocks.query).toHaveBeenCalledOnce();
});

it("requires the current account session even with a valid state and intent cookie", async () => {
  await session("google:other"); mocks.query.mockResolvedValueOnce(stored());
  await expect(completeGitHubConnection("oauth-state","101",{id:101,login:"renamed"})).rejects.toMatchObject({code:"github_reconnect"});
});

it("claims the attempt and provider subject atomically without replacing a different owner", async () => {
  mocks.query.mockResolvedValueOnce(stored()).mockResolvedValueOnce({rows:[{user_id:"google:900"}]});
  expect(await completeGitHubConnection("oauth-state","101",{id:101,login:"renamed"})).toMatchObject({sub:"google:900",sessionId:"stable"});
  const [statement, params] = mocks.query.mock.calls[1];
  expect(statement).toContain("consumed_at is null and expires_at > now()");
  expect(statement).toContain("where auth_identities.user_id = excluded.user_id");
  expect(params).toContain(attempt.sessionHash); expect(params).toContain(hash("oauth-state")); expect(params).toContain("101");
  expect(params).not.toContain("renamed");
});

it("reports an already-owned GitHub without replacing the current session", async () => {
  mocks.query.mockResolvedValueOnce(stored()).mockResolvedValueOnce({rows:[]});
  await expect(completeGitHubConnection("oauth-state","101",{id:101,login:"renamed"})).rejects.toMatchObject({code:"github_linked_elsewhere"});
});

it("maps a simultaneous second GitHub connection to a safe ownership conflict", async () => {
  mocks.query.mockResolvedValueOnce(stored()).mockRejectedValueOnce({ code: "23505", message: "private-database-details" });
  await expect(completeGitHubConnection("oauth-state","101",{id:101,login:"renamed"})).rejects.toMatchObject({code:"github_linked_elsewhere"});
});

it("allows ordinary GitHub sign-in only when neither state nor cookie belongs to linking", async () => {
  mocks.get.mockReturnValue(undefined); mocks.query.mockResolvedValueOnce({rows:[]});
  expect(await completeGitHubConnection("ordinary-state","101",{id:101,login:"renamed"})).toBeNull();
});

it("clears the private attempt cookie and derives owner state from the verified session", async () => {
  expect(await accountState("google:900")).toBe("google");
  await expect(accountState("victim")).rejects.toMatchObject({status:401});
  await clearConnection();
  expect(mocks.set).toHaveBeenCalledWith(LINK_COOKIE,"",expect.objectContaining({maxAge:0,httpOnly:true}));
});

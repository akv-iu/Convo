import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enrichmentStart } from "@/contracts/fixtures/enrichment";
import { routes } from "@/contracts/routes";
import { emptyOwnerData, OwnerData } from "@/server/profile/enrichment/model";
const mocks = vi.hoisted(() => ({ owner: "google:101" as string | null, enabled: true,
  rows: new Map<string, OwnerData>(), after: vi.fn(), token: vi.fn(), fetch: vi.fn(), githubIds: [{ id: "101" }],
  profile: { githubLogin: "recorded-user", textVersion: 7, bio: "My saved bio" } }));
vi.mock("@/server/config", () => ({ config: { fakeApi: false, fakeSearch: true, fakeAi: true,
  get profileEnrichmentEnabled() { return mocks.enabled; } } }));
vi.mock("@/server/auth", () => ({ getUserId: async () => mocks.owner }));
vi.mock("@/server/profile/connection", () => ({ currentToken: mocks.token, accountState: async () => "google", beginGitHubConnection: vi.fn() }));
vi.mock("@/server/profile/service", async original => ({ ...await original<typeof import("@/server/profile/service")>(),
  readUser: async () => ({ ...mocks.profile }) }));
vi.mock("../../../../db", () => ({ db: () => ({ select: () => ({ from: () => ({ where: () => ({ limit: async () => mocks.githubIds }) }) }) }) }));
vi.mock("@/server/profile/enrichment/storage", () => ({
  readOwner: async (owner: string) => { const data = mocks.rows.get(owner); return data ? structuredClone(data) : undefined; },
  mutateOwner: async <T>(owner: string, change: (data: OwnerData) => T) => {
    const data = structuredClone(mocks.rows.get(owner) ?? emptyOwnerData());
    const value = change(data); mocks.rows.set(owner, OwnerData.parse(data)); return structuredClone(value);
  }, ownersDueForCleanup: async () => [], deferCleanup: async () => undefined,
}));
vi.mock("next/server", async original => ({ ...await original<typeof import("next/server")>(), connection: async () => undefined, after: mocks.after }));
import { POST as start } from "./route";
import { POST as retry } from "./[id]/retry/route";
import { GET as getJob } from "./[id]/route";
import { POST as cancel } from "./[id]/cancel/route";
const ctx = (id = "") => ({ params: Promise.resolve({ id }) });
const request = (body: unknown) => new Request("http://localhost/api/profile-enrichment", { method: "POST",
  headers: { "Content-Type": "application/json", origin: "http://localhost" }, body: JSON.stringify(body) });
function input() { const body = enrichmentStart(); body.github.import = false;
  body.publicProfile = { kind: "text", text: "Develops task scheduling and scientific software." }; return body; }
const poll = async (id: string) => (await getJob(new Request(`http://localhost/api/profile-enrichment/${id}`), ctx(id))).json();
const drain = async () => { const callbacks = mocks.after.mock.calls.splice(0).map(([callback]) => callback as () => Promise<void>);
  await Promise.all(callbacks.map(callback => callback())); };
beforeEach(() => { vi.clearAllMocks(); mocks.rows.clear(); mocks.owner = "google:101"; mocks.enabled = true;
  mocks.githubIds = [{ id: "101" }]; mocks.profile.textVersion = 7;
  mocks.token.mockResolvedValue({ sub: "google:101", githubToken: "recorded-private-token" });
  mocks.fetch.mockImplementation(() => { throw new Error("Unexpected external request"); }); vi.stubGlobal("fetch", mocks.fetch); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

it("runs a real pasted-source job after responding, preserves its base revision, and never publishes automatically", async () => {
  const response = await start(request(input()), ctx()); expect(response.status).toBe(200);
  const job = routes.startEnrichment.response.parse(await response.json()); expect(job.state).toBe("queued");
  expect((await poll(job.jobId)).draft).toBeNull(); expect(mocks.token).not.toHaveBeenCalled();
  await drain(); const ready = await poll(job.jobId);
  expect(ready).toMatchObject({ state: "ready", draft: { baseTextVersion: 7, evidence: [{ title: "Profile text" }] } });
  expect(mocks.profile.bio).toBe("My saved bio"); expect(mocks.fetch).not.toHaveBeenCalled();
});
it("replays an identical queued start without a second provider call or a changed original text revision", async () => {
  const body = input(); body.github = { import: true, bio: true, repos: false, orgs: false };
  mocks.fetch.mockResolvedValue(Response.json({ id: 101, login: "recorded-user", name: null, bio: "Builds compilers", avatar_url: "https://example.org/avatar" }));
  const first = await (await start(request(body), ctx())).json(); mocks.profile.textVersion = 8;
  const second = await (await start(request(body), ctx())).json(); expect(second.jobId).toBe(first.jobId);
  await drain(); expect(mocks.fetch).toHaveBeenCalledTimes(1);
  expect(await poll(first.jobId)).toMatchObject({ state: "ready", draft: { baseTextVersion: 7, needsReview: true } });
  expect(JSON.stringify(mocks.rows.get("google:101"))).not.toContain("recorded-private-token");
  mocks.token.mockClear();
  const third = await (await start(request(body), ctx())).json(); expect(third.state).toBe("ready");
  expect(mocks.token).not.toHaveBeenCalled();
  expect(mocks.after.mock.calls).toHaveLength(0);
});
it("retries a partial job with a reconnected GitHub token and the latest text revision", async () => {
  const body = input(); body.github = { import: true, bio: true, repos: false, orgs: false };
  mocks.token.mockResolvedValue({ sub: "google:101" });
  const job = await (await start(request(body), ctx())).json(); await drain();
  expect(await poll(job.jobId)).toMatchObject({ state: "partial", sources: [
    { source: "github", status: "failed", reason: "github_reconnect" }, { source: "research", status: "not_selected" },
    { source: "public_profile", status: "done" }, { source: "cv", status: "not_selected" },
  ] });
  mocks.profile.textVersion = 8; mocks.token.mockResolvedValue({ sub: "google:101", githubToken: "reconnected-token" });
  mocks.fetch.mockResolvedValue(Response.json({ id: 101, login: "recorded-user", name: null, bio: "Builds compilers", avatar_url: "https://example.org/avatar" }));
  expect((await retry(request({}), ctx(job.jobId))).status).toBe(200); await drain();
  expect(await poll(job.jobId)).toMatchObject({ state: "ready", draft: { baseTextVersion: 8 } });
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
  expect(mocks.fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer reconnected-token");
});
it("cannot let a delayed duplicate callback claim a newer retry with old credentials", async () => {
  const body = input(); body.github = { import: true, bio: true, repos: false, orgs: false };
  mocks.token.mockResolvedValue({ sub: "google:101" });
  const job = await (await start(request(body), ctx())).json(); await start(request(body), ctx());
  const firstCallback = mocks.after.mock.calls.shift()![0] as () => Promise<void>;
  await firstCallback(); expect(await poll(job.jobId)).toMatchObject({ state: "partial" });
  mocks.token.mockResolvedValue({ sub: "google:101", githubToken: "reconnected-token" });
  mocks.fetch.mockResolvedValue(Response.json({ id: 101, login: "recorded-user", name: null, bio: "Builds compilers", avatar_url: "https://example.org/avatar" }));
  expect((await retry(request({}), ctx(job.jobId))).status).toBe(200);
  const delayedCallback = mocks.after.mock.calls.shift()![0] as () => Promise<void>;
  await delayedCallback();
  expect(await poll(job.jobId)).toMatchObject({ state: "queued" });
  await drain(); expect(await poll(job.jobId)).toMatchObject({ state: "ready" });
});
it("does not execute a job cancelled before its callback runs", async () => {
  const job = await (await start(request(input()), ctx())).json();
  expect((await cancel(request({}), ctx(job.jobId))).status).toBe(200); await drain();
  expect(await poll(job.jobId)).toMatchObject({ state: "cancelled", draft: null }); expect(mocks.fetch).not.toHaveBeenCalled();
});
it("recovers an unscheduled job through lease expiry and explicit retry", async () => {
  vi.useFakeTimers(); const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  mocks.after.mockImplementationOnce(() => { throw new Error("Recorded missing request scheduler"); });
  const job = await (await start(request(input()), ctx())).json();
  expect((await retry(request({}), ctx(job.jobId))).status).toBe(409);
  vi.advanceTimersByTime(91_000); expect(await poll(job.jobId)).toMatchObject({ state: "stalled" });
  expect((await retry(request({}), ctx(job.jobId))).status).toBe(200); await drain();
  expect(await poll(job.jobId)).toMatchObject({ state: "ready" }); expect(warning).toHaveBeenCalled();
});
it("rejects unlinked GitHub and foreign cookie credentials before creating a job", async () => {
  mocks.githubIds = []; const body = enrichmentStart();
  expect((await start(request(body), ctx())).status).toBe(409); expect(mocks.rows.size).toBe(0);
  mocks.token.mockResolvedValue({ sub: "someone-else", githubToken: "foreign-token" });
  const response = await start(request(body), ctx()); expect(response.status).toBe(401);
  expect(JSON.stringify(await response.json())).not.toContain("foreign-token"); expect(mocks.rows.size).toBe(0);
});
it("keeps disabled, signed-out and cross-origin requests from scheduling or storing work", async () => {
  mocks.enabled = false; expect((await start(request(input()), ctx())).status).toBe(404);
  mocks.enabled = true; mocks.owner = null; expect((await start(request(input()), ctx())).status).toBe(401);
  mocks.owner = "google:101"; const req = request(input()); req.headers.set("origin", "https://foreign.example");
  expect((await start(req, ctx())).status).toBe(403); expect(mocks.rows.size).toBe(0); expect(mocks.after).not.toHaveBeenCalled();
});

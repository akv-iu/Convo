import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EnrichmentJob } from "@/contracts/enrichment";
import { PgDialect } from "drizzle-orm/pg-core";
const mocks = vi.hoisted(() => ({ token: vi.fn(), query: vi.fn(), after: vi.fn(), run: vi.fn(), warning: vi.fn() }));
vi.mock("../connection", () => ({ currentToken: mocks.token }));
vi.mock("../../../../db", () => ({ db: () => ({ select: () => ({ from: () => ({ where: (where: unknown) => ({
  limit: async () => mocks.query(where),
}) }) }) }) }));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("./runner", () => ({ runEnrichment: mocks.run }));
vi.mock("@/server/config", () => ({ config: { fakeAi: true, openAlexApiKey: "recorded-openalex" } }));
import { loadGitHubConnection, scheduleEnrichment } from "./execution";

const queued = () => EnrichmentJob.parse({ jobId: "job", state: "queued", phase: "collecting", selectionGeneration: 1,
  draft: null, expiresAt: new Date(Date.now() + 60_000).toISOString(), sources: ["github", "research", "public_profile", "cv"].map(source => ({
    source, sourceId: `owner:${source}`, status: source === "github" ? "waiting" : "not_selected", items: 0,
    selection: source === "github" ? { label: "GitHub" } : null,
  })) });
beforeEach(() => { vi.clearAllMocks(); mocks.token.mockResolvedValue({ sub: "owner", githubToken: "private-token" });
  mocks.query.mockReturnValue([{ id: "123" }]); mocks.run.mockResolvedValue(undefined); mocks.after.mockReset();
  vi.spyOn(console, "warn").mockImplementation(mocks.warning); });
afterEach(() => vi.restoreAllMocks());

it("captures the cookie owner's token and numeric linked account without using a login", async () => {
  expect(await loadGitHubConnection("owner")).toEqual({ accountId: "123", accessToken: "private-token" });
  const query = new PgDialect().sqlToQuery(mocks.query.mock.calls[0][0]);
  expect(query.params).toEqual(["owner", "github"]);
});
it.each([null, { sub: "another-owner", githubToken: "private-token" }])("rejects a missing or foreign cookie before querying identities", async token => {
  mocks.token.mockResolvedValue(token);
  await expect(loadGitHubConnection("owner")).rejects.toMatchObject({ status: 401 });
  expect(mocks.query).not.toHaveBeenCalled();
});
it("keeps a connected identity with a missing token so the provider can report reconnect", async () => {
  mocks.token.mockResolvedValue({ sub: "owner" });
  expect(await loadGitHubConnection("owner")).toEqual({ accountId: "123", accessToken: "" });
  mocks.query.mockReturnValue([]); expect(await loadGitHubConnection("owner")).toBeUndefined();
});
it("sanitizes storage or cookie failures without logging their secret text", async () => {
  mocks.query.mockImplementationOnce(() => { throw new Error("token=private-token"); });
  await expect(loadGitHubConnection("owner")).rejects.toMatchObject({ status: 503, code: "provider_down" });
  expect(mocks.warning).not.toHaveBeenCalled();
});
it("defers work with captured credentials/settings and exposes no token in its return", async () => {
  const connection = { accountId: "123", accessToken: "private-token" };
  expect(scheduleEnrichment("owner", queued(), connection, "attempt")).toBeUndefined();
  expect(mocks.run).not.toHaveBeenCalled(); expect(mocks.after).toHaveBeenCalledTimes(1);
  await mocks.after.mock.calls[0][0]();
  expect(mocks.run).toHaveBeenCalledWith("owner", "job", { github: connection, openAlexApiKey: "recorded-openalex", fakeAi: true, dispatchToken: "attempt" });
});
it("does not capture unused GitHub credentials for a completed source", async () => {
  const job = queued(); job.sources[0].status = "done";
  scheduleEnrichment("owner", job, { accountId: "123", accessToken: "private-token" }, "attempt");
  await mocks.after.mock.calls[0][0]();
  expect(mocks.run.mock.calls[0][2].github).toBeUndefined();
});
it.each(["manual", "ready", "partial", "running", "accepted", "cancelled", "superseded", "stalled", "failed"] as const)("does not schedule %s work", state => {
  scheduleEnrichment("owner", { ...queued(), state }, undefined, "attempt"); expect(mocks.after).not.toHaveBeenCalled();
});
it("reports deferred failures without retaining the error and tolerates an unavailable request scheduler", async () => {
  mocks.run.mockRejectedValue(new Error("private-token")); scheduleEnrichment("owner", queued(), undefined, "attempt");
  await mocks.after.mock.calls[0][0](); expect(JSON.stringify(mocks.warning.mock.calls)).not.toContain("private-token");
  mocks.after.mockImplementationOnce(() => { throw new Error("private-token"); });
  expect(() => scheduleEnrichment("owner", queued(), undefined, "attempt")).not.toThrow();
  expect(JSON.stringify(mocks.warning.mock.calls)).not.toContain("private-token");
});

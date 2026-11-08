import { beforeEach, expect, it, vi } from "vitest";
import { enrichmentIdentity, enrichmentStart } from "@/contracts/fixtures/enrichment";
const mocks = vi.hoisted(() => ({ currentProvider: vi.fn(), account: vi.fn(), staged: vi.fn(), save: vi.fn(),
  create: vi.fn(), user: vi.fn(), job: vi.fn(), retry: vi.fn(), github: vi.fn(), schedule: vi.fn(), replay: vi.fn() }));
vi.mock("../connection", () => ({ accountState: mocks.currentProvider }));
vi.mock("../identities", () => ({ readAccountState: mocks.account }));
vi.mock("../service", () => ({ readUser: mocks.user }));
vi.mock("./state", () => ({ readPrivateState: mocks.staged, saveIdentity: mocks.save, findStartJob: mocks.replay,
  prepareJob: async (...args: unknown[]) => ({ job: await mocks.create(...args), attempt: "attempt" }), getJob: mocks.job,
  prepareRetry: async (...args: unknown[]) => ({ job: await mocks.retry(...args), attempt: "attempt" }) }));
vi.mock("./execution", () => ({ loadGitHubConnection: mocks.github, scheduleEnrichment: mocks.schedule,
  needsGitHub: (job: { sources: { source: string; status: string }[] }) => job.sources.some(s => s.source === "github" && ["waiting", "failed"].includes(s.status)) }));
import { enrichmentState, saveEnrichmentIdentity, startEnrichment, getEnrichment, retryEnrichment } from "./service";

beforeEach(() => {
  vi.clearAllMocks(); mocks.currentProvider.mockResolvedValue("google"); mocks.github.mockResolvedValue(undefined); mocks.replay.mockResolvedValue(null);
  mocks.account.mockResolvedValue({ signIn: { provider: "google" }, github: { connected: false, login: null }, onboarded: false });
  mocks.staged.mockResolvedValue({ identity: enrichmentIdentity, job: { jobId: "saved-job", state: "manual" }, pendingCv: null });
  mocks.save.mockResolvedValue({ identity: enrichmentIdentity, job: null, pendingCv: null });
  mocks.user.mockResolvedValue({ textVersion: 7, githubLogin: "connected-login" });
  mocks.create.mockResolvedValue({ jobId: "job", state: "manual", sources: [] });
  mocks.job.mockResolvedValue({ jobId: "job", state: "partial", sources: [] });
  mocks.retry.mockResolvedValue({ jobId: "job", state: "queued", sources: [] });
});
it("uses the current text revision when polling or deliberately retrying a draft", async () => {
  await getEnrichment("owner", "job"); await retryEnrichment("owner", "job");
  expect(mocks.job).toHaveBeenCalledWith("owner", "job", 7); expect(mocks.retry).toHaveBeenCalledWith("owner", "job", 7);
  expect(mocks.schedule).toHaveBeenCalledWith("owner", expect.objectContaining({ state: "queued" }), undefined, "attempt");
});
it("composes authenticated owner state with only safe staging metadata", async () => {
  expect(await enrichmentState("owner")).toMatchObject({ signIn: { provider: "google" }, identity: enrichmentIdentity, job: { jobId: "saved-job" } });
  expect(mocks.staged).toHaveBeenCalledWith("owner"); expect(mocks.account).toHaveBeenCalledWith("owner", "google");
});
it("stages answers without publishing or changing the public profile", async () => {
  expect(await saveEnrichmentIdentity("owner", enrichmentIdentity)).toMatchObject({ identity: enrichmentIdentity, onboarded: false });
  expect(mocks.save).toHaveBeenCalledWith("owner", enrichmentIdentity);
});
it("allows manual continuation with the saved text revision and no credential access", async () => {
  const body = enrichmentStart(); body.github.import = false; body.research = { skip: true }; body.publicProfile = { skip: true };
  expect(await startEnrichment("owner", body)).toMatchObject({ state: "manual" });
  expect(mocks.create).toHaveBeenCalledWith("owner", body, null, 7); expect(mocks.github).not.toHaveBeenCalled();
});
it.each(["github", "research", "publicProfile", "cv"] as const)("saves and schedules selected %s with server-owned context", async source => {
  const body = enrichmentStart(); body.github.import = source === "github";
  if (source === "research") body.research = { discoveryId: "preview", candidateId: "author" };
  if (source === "publicProfile") body.publicProfile = { kind: "text", text: "private" };
  if (source === "cv") body.cv = { uploadId: crypto.randomUUID() };
  const connection = { accountId: "123", accessToken: "private-token" }; mocks.github.mockResolvedValue(connection);
  mocks.create.mockResolvedValue({ jobId: "job", state: "queued", sources: [{ source, status: "waiting" }] });
  expect(await startEnrichment("owner", body)).toMatchObject({ jobId: "job", state: "queued" });
  expect(mocks.create).toHaveBeenCalledWith("owner", body, source === "github" ? "connected-login" : null, 7);
  expect(mocks.schedule).toHaveBeenCalledWith("owner", expect.objectContaining({ state: "queued" }), source === "github" ? connection : undefined, "attempt");
  expect(JSON.stringify(mocks.create.mock.calls)).not.toContain("private-token");
});
it("does not treat a stored handle without a linked identity as a GitHub connection", async () => {
  await startEnrichment("owner", enrichmentStart());
  expect(mocks.create).toHaveBeenCalledWith("owner", expect.anything(), null, 7);
});
it.each(["done", "failed"])("reloads GitHub context on retry only if that source needs collection (%s)", async status => {
  mocks.job.mockResolvedValue({ jobId: "job", state: "partial", sources: [{ source: "github", status }] });
  const connection = { accountId: "123", accessToken: "new-token" }; mocks.github.mockResolvedValue(connection);
  await retryEnrichment("owner", "job");
  expect(mocks.github).toHaveBeenCalledTimes(status === "failed" ? 1 : 0);
  expect(mocks.schedule.mock.calls[0][2]).toEqual(status === "failed" ? connection : undefined);
});
it("does not persist new work when credential capture fails", async () => {
  mocks.github.mockRejectedValue(Object.assign(new Error("Sign in first"), { status: 401 }));
  await expect(startEnrichment("owner", enrichmentStart())).rejects.toMatchObject({ status: 401 });
  expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.schedule).not.toHaveBeenCalled();
});

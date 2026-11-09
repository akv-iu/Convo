import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_USER_A } from "@/contracts/fixtures";
import { enrichmentIdentity, enrichmentStart } from "@/contracts/fixtures/enrichment";
import { EnrichmentError, MAX_CV_BYTES } from "@/contracts/enrichment";
import { routes } from "@/contracts/routes";
import { store } from "@/contracts/fake/store";

const { runtime, identity } = vi.hoisted(() => ({
  runtime: { fakeApi: true, profileEnrichmentEnabled: true }, identity: { userId: "u_demo_a" as string | null },
}));
vi.mock("@/server/config", () => ({ config: runtime }));
vi.mock("@/server/auth", () => ({ getUserId: async () => identity.userId }));
vi.mock("next/server", async original => ({ ...await original<typeof import("next/server")>(), connection: async () => undefined }));
import { POST as start, GET as state, PUT as saveIdentity } from "./route";
import { POST as connect } from "./github/connect/route";
import { POST as discover } from "./discover/route";
import { POST as upload } from "./cv/route";
import { POST as removeCv } from "./cv/[id]/remove/route";
import { GET as getJob } from "./[id]/route";
import { POST as retry } from "./[id]/retry/route";
import { POST as accept } from "./[id]/accept/route";
import { POST as cancel } from "./[id]/cancel/route";
import { GET as sources } from "./sources/route";
import { POST as removeSource } from "./sources/[id]/remove/route";
import { fake } from "@/contracts/fake/handlers";
import { real } from "@/server/real";

const context = (id = "") => ({ params: Promise.resolve({ id }) });
const json = (body: unknown) => new Request("http://localhost/api/profile-enrichment", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const multipart = (value: string | File) => {
  const body = new FormData(); body.set("consent", "true");
  body.set(typeof value === "string" ? "text" : "file", value);
  return new Request("http://localhost/api/profile-enrichment/cv", { method: "POST", body });
};
beforeEach(() => {
  store.reset(); runtime.fakeApi = true; runtime.profileEnrichmentEnabled = true; identity.userId = DEMO_USER_A;
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No live services allowed in this test."); }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("profile enrichment HTTP foundation", () => {
  it("serves the full fake contract through every route with no provider calls", async () => {
    routes.enrichmentState.response.parse(await (await state(new Request("http://localhost/api/profile-enrichment"), context())).json());
    const identityRequest = new Request("http://localhost/api/profile-enrichment", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(enrichmentIdentity) });
    routes.saveEnrichmentIdentity.response.parse(await (await saveIdentity(identityRequest, context())).json());
    routes.connectGitHub.response.parse(await (await connect(json({}), context())).json());
    const { name, workplaceName, rorId, orcid } = enrichmentIdentity;
    const lookup = { name, workplaceName, rorId, orcid };
    const found = await discover(json({ ...lookup, source: "research" }), context());
    const discovery = routes.discoverEnrichment.response.parse(await found.json());
    const uploaded = await upload(multipart(new File(["%PDF-demo fixture"], "demo.pdf", { type: "application/pdf" })), context());
    const cv = routes.uploadCv.response.parse(await uploaded.json());
    const body = { ...enrichmentStart(), research: { discoveryId: discovery.discoveryId, candidateId: discovery.candidates[0].id },
      publicProfile: { kind: "text", text: "Recorded professional text" }, cv: { uploadId: cv.uploadId } };
    const started = routes.startEnrichment.response.parse(await (await start(json(body), context())).json());
    const ctx = context(started.jobId);
    const get = () => new Request("http://localhost/api/profile-enrichment/" + started.jobId);
    await getJob(get(), ctx); await getJob(get(), ctx);
    const ready = routes.getEnrichment.response.parse(await (await getJob(get(), ctx)).json());
    expect(ready.state).toBe("ready");
    const saved = await accept(json({ draftVersion: ready.draft!.draftVersion, baseTextVersion: ready.draft!.baseTextVersion,
      bio: ready.draft!.bio, expertise: ready.draft!.expertise.map(e => e.label), evidenceIds: ready.draft!.evidence.map(e => e.id) }), ctx);
    expect(saved.status).toBe(200);
    expect(saved.headers.get("cache-control")).toBe("no-store");
    routes.acceptEnrichment.response.parse(await saved.json());
    const list = routes.enrichmentSources.response.parse(await (await sources(get(), context())).json());
    const removed = await removeSource(json({}), context(list[0].id));
    routes.removeEnrichmentSource.response.parse(await removed.json());
    const second = routes.startEnrichment.response.parse(await (await start(json(enrichmentStart()), context())).json());
    expect((await retry(json({}), context(second.jobId))).status).toBe(409);
    routes.cancelEnrichment.response.parse(await (await cancel(json({}), context(second.jobId))).json());
    expect((await removeCv(json({}), context(cv.uploadId))).status).toBe(200);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([state, saveIdentity, connect, discover, upload, start, getJob, retry, accept, cancel, removeCv, sources, removeSource])(
    "keeps routes disabled even in fake mode and rejects unauthenticated reads/writes", async handler => {
      runtime.profileEnrichmentEnabled = false;
      const disabled = await handler(json({}), context("missing"));
      expect(disabled.status).toBe(404);
      expect(EnrichmentError.parse(await disabled.json()).code).toBe("feature_disabled");
      runtime.profileEnrichmentEnabled = true; identity.userId = null;
      const rejected = await handler(json({}), context("missing"));
      expect(rejected.status).toBe(401);
      expect(EnrichmentError.parse(await rejected.json()).code).toBe("sign_in_required");
    },
  );

  it("does not parse a multipart body before authentication", async () => {
    identity.userId = null;
    const request = multipart("private CV");
    expect((await upload(request, context())).status).toBe(401);
    expect(request.bodyUsed).toBe(false);
  });

  it("blocks cross-origin form posts and permits the application's own origin", async () => {
    const request = multipart("Private CV");
    request.headers.set("origin", "https://untrusted.example");
    expect((await upload(request, context())).status).toBe(403);
    expect(request.bodyUsed).toBe(false);
    const own = multipart("Private CV"); own.headers.set("origin", "http://localhost");
    expect((await upload(own, context())).status).toBe(200);
  });

  it("accepts pasted CV text without returning the contents", async () => {
    const response = await upload(multipart("Private CV fallback"), context());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ filename: null, characters: 19 });
    expect(JSON.stringify(body)).not.toContain("Private CV fallback");
  });

  it.each([
    ["not a PDF", 415, "cv_unsupported"],
    ["%PDF-1.7 /Encrypt", 422, "cv_encrypted"],
    ["%PDF-1.7 DEMO:UNREADABLE", 422, "cv_unreadable"],
    ["%PDF-1.7 DEMO:SCANNED", 422, "cv_unreadable"],
  ] as const)("checks actual file bytes for recorded outcomes: %s", async (bytes, status, code) => {
    const response = await upload(multipart(new File([bytes], "recorded.pdf", { type: "application/pdf" })), context());
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ code });
  });

  it("accepts a recorded DOCX container marker without pretending to extract it", async () => {
    const file = new File([new Uint8Array([0x50,0x4b,3,4]), "[Content_Types].xml word/document.xml"], "recorded.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    expect((await upload(multipart(file), context())).status).toBe(200);
  });

  it("returns machine-readable running retry and idempotency conflict errors", async () => {
    const input = enrichmentStart();
    const job = await (await start(json(input), context())).json();
    const running = await retry(json({}), context(job.jobId));
    expect(running.status).toBe(409);
    expect(await running.json()).toMatchObject({ code: "running", retryAfterSeconds: 30 });
    const conflicting = await start(json({ ...input, publicProfile: { kind: "text", text: "Edited" } }), context());
    expect(conflicting.status).toBe(409);
    expect(await conflicting.json()).toMatchObject({ code: "idempotency_conflict" });
  });

  it.each([
    [() => json({ file: { name: "cv.pdf" }, consent: true }), 415],
    [() => multipart(new File(["text"], "cv.txt", { type: "text/plain" })), 415],
    [() => multipart(new File([], "cv.pdf", { type: "application/pdf" })), 400],
    [() => multipart(new File([new Uint8Array(MAX_CV_BYTES + 1)], "cv.pdf", { type: "application/pdf" })), 413],
    [() => multipart("x".repeat(30_001)), 400],
  ] as const)("rejects invalid uploads", async (make, status) => {
    const response = await upload(make(), context());
    expect(response.status).toBe(status);
    EnrichmentError.parse(await response.json());
  });

  it.each(["consent", "file", "unexpected"])("rejects duplicate or unknown multipart fields: %s", async key => {
    const body = new FormData(); body.append("consent", "true"); body.append("file", new File(["fixture"], "cv.pdf", { type: "application/pdf" }));
    body.append(key, "extra");
    expect((await upload(new Request("http://localhost/api/profile-enrichment/cv", { method: "POST", body }), context())).status).toBe(400);
  });

  it.each(["not JSON", JSON.stringify({ ...enrichmentStart(), userId: "someone-else" })])("rejects malformed or extra JSON fields", async body => {
    const response = await start(new Request("http://localhost/api/profile-enrichment", { method: "POST", headers: { "Content-Type": "application/json" }, body }), context());
    expect(response.status).toBe(400);
    expect(await response.json()).not.toHaveProperty("issues");
  });

  it("bounds streamed bodies without trusting Content-Length", async () => {
    const request = new Request("http://localhost/api/profile-enrichment", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "x".repeat(256 * 1024 + 1),
    });
    expect((await start(request, context())).status).toBe(413);
  });

  it("dispatches to the real implementation when the fake API is disabled", async () => {
    const body = enrichmentStart();
    const result = await fake.startEnrichment({ userId: DEMO_USER_A, body, params: {}, query: new URLSearchParams() });
    const handler = vi.spyOn(real, "startEnrichment").mockResolvedValueOnce(result);
    runtime.fakeApi = false;
    const response = await start(json(body), context());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ userId: DEMO_USER_A, body }));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("hides provider errors, rejects off-contract replies and preserves Next runtime signals", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(fake, "startEnrichment").mockRejectedValueOnce(new Error("secret provider token"));
    const response = await start(json(enrichmentStart()), context());
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("secret");
    expect(warn).toHaveBeenCalledWith("[profile-enrichment] startEnrichment unavailable");
    vi.spyOn(fake, "discoverEnrichment").mockResolvedValueOnce({ raw: "secret" } as never);
    expect((await discover(json({ name: enrichmentIdentity.name, workplaceName: null, rorId: null, orcid: null, source: "research" }), context())).status).toBe(500);
    const signal = { digest: "NEXT_REDIRECT" };
    vi.spyOn(real, "startEnrichment").mockRejectedValueOnce(signal);
    runtime.fakeApi = false;
    await expect(start(json(enrichmentStart()), context())).rejects.toBe(signal);
  });
});

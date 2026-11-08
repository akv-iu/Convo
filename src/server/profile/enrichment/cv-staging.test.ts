import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MAX_SOURCE_TEXT } from "@/contracts/enrichment";
import { enrichmentIdentity } from "@/contracts/fixtures/enrichment";
import type { RouteBody } from "@/contracts/routes";
import { emptyOwnerData, INPUT_TTL_MS, OwnerData } from "./model";

// Durable owner storage, in memory: a mutation that throws saves nothing, as in Postgres.
const mocks = vi.hoisted(() => ({ data: new Map<string, OwnerData>() }));
vi.mock("./storage", () => ({
  mutateOwner: async <T>(owner: string, change: (data: OwnerData) => T): Promise<T> => {
    const data = structuredClone(mocks.data.get(owner) ?? emptyOwnerData());
    const result = change(data); mocks.data.set(owner, OwnerData.parse(data)); return structuredClone(result);
  },
  ownersDueForCleanup: vi.fn(), deferCleanup: vi.fn(),
}));
// The real parser and worker, watched so tests can tell whether parsing started.
vi.mock("./cv-parser", async original => {
  const real = await original<typeof import("./cv-parser")>();
  return { ...real, extractCvText: vi.fn(real.extractCvText) };
});
import { CV_LIMITS, extractCvText } from "./cv-parser";
import { createJob, readPrivateState, removeCv, stageCvText } from "./state";

const owner = "google:101";
const PDF = "application/pdf";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const bytes = (name: string) => readFileSync(new URL(`./fixtures/cv/${name}`, import.meta.url));
const upload = (name: string, type = name.endsWith(".pdf") ? PDF : DOCX, as = name): RouteBody<"uploadCv"> =>
  ({ consent: true, file: new File([bytes(name)], as, { type }) });
const saved = () => mocks.data.get(owner)!;
const startWithCv = (uploadId: string): RouteBody<"startEnrichment"> => ({ identity: { ...enrichmentIdentity }, idempotencyKey: crypto.randomUUID(),
  github: { import: false, bio: false, repos: false, orgs: false }, research: null, publicProfile: null, cv: { uploadId } });
const logs = () => (["log", "info", "warn", "error", "debug"] as const).map(level => vi.spyOn(console, level));

beforeEach(() => { mocks.data.clear(); vi.mocked(extractCvText).mockClear(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it.each([["text.pdf", "Example University: built data pipelines"], ["text.docx", "Python, Rust, numerical methods"]])(
  "stages %s as owner-private text with metadata only in the reply", async (name, line) => {
    const quiet = logs();
    const cv = await stageCvText(owner, upload(name));
    expect(cv).toEqual({ uploadId: expect.any(String), filename: name, characters: saved().cv!.text.length, warnings: [], expiresAt: expect.any(String) });
    expect(Date.parse(cv.expiresAt) - Date.now()).toBeGreaterThan(INPUT_TTL_MS - 5_000);
    expect(saved().cv!.text).toContain(line);
    expect(JSON.stringify(cv)).not.toContain(line);
    // Only text is kept: no file bytes, no PDF or ZIP signature in the stored document.
    expect(JSON.stringify(saved())).not.toMatch(/%PDF-|PK\u0003\u0004|word\/document\.xml/);
    expect((await readPrivateState(owner)).pendingCv).toEqual(cv);
    for (const log of quiet) expect(log).not.toHaveBeenCalled();
  });

it("keeps pasted text as given, with no filename", async () => {
  const cv = await stageCvText(owner, { consent: true, text: "Skills\nRust" });
  expect(cv).toMatchObject({ filename: null, characters: 11, warnings: [] });
  expect(saved().cv!.text).toBe("Skills\nRust");
  expect(extractCvText).not.toHaveBeenCalled();
});

it("keeps the first 30,000 characters of a long CV and says so", async () => {
  const cv = await stageCvText(owner, upload("long.pdf"));
  expect(cv).toMatchObject({ characters: MAX_SOURCE_TEXT, warnings: ["cv_truncated"] });
  expect(saved().cv!.text).toHaveLength(MAX_SOURCE_TEXT);
});

it("shows only the file's own name, without folders or control characters", async () => {
  expect((await stageCvText(owner, upload("text.pdf", PDF, "C:\\Users\\ada\\My\u0007 CV.pdf"))).filename).toBe("My  CV.pdf");
  expect((await stageCvText(owner, upload("text.pdf", PDF, "folder/\u0001"))).filename).toBe("CV");
});

it.each([
  ["encrypted.pdf", PDF, "cv_encrypted", 422],
  ["office-encrypted.docx", DOCX, "cv_encrypted", 422],
  ["image.png", PDF, "cv_unsupported", 415], // a declared type doesn't make it a PDF
  ["legacy.doc", DOCX, "cv_unsupported", 415],
  ["scanned.pdf", PDF, "cv_unreadable", 422],
  ["malformed.pdf", PDF, "cv_unreadable", 422],
] as const)("refuses %s as %s and keeps the previous CV", async (name, type, code, status) => {
  const previous = await stageCvText(owner, { consent: true, text: "Earlier pasted CV" });
  await expect(stageCvText(owner, upload(name, type))).rejects.toMatchObject({ code, status });
  expect(saved().cv).toEqual({ metadata: previous, text: "Earlier pasted CV" });
});

it("stops a parse that runs past its deadline and keeps the previous CV", async () => {
  const previous = await stageCvText(owner, upload("text.docx"));
  await expect(stageCvText(owner, upload("text.pdf"), { ...CV_LIMITS, timeoutMs: 1 })).rejects.toMatchObject({ code: "cv_unreadable", status: 422 });
  expect(saved().cv!.metadata).toEqual(previous);
  expect(saved().limits.upload!.count).toBe(2); // the timed-out attempt counted
});

it("counts every attempt before parsing and refuses the seventh without parsing", async () => {
  for (let n = 0; n < 6; n++) await expect(stageCvText(owner, upload("malformed.pdf"))).rejects.toMatchObject({ code: "cv_unreadable" });
  vi.mocked(extractCvText).mockClear();
  await expect(stageCvText(owner, upload("text.pdf"))).rejects.toMatchObject({ status: 429, code: "rate_limited" });
  expect(extractCvText).not.toHaveBeenCalled();
  expect(saved().cv).toBeNull();
});

it("replaces the pending CV: the old one is tombstoned and work using it is cancelled", async () => {
  const first = await stageCvText(owner, { consent: true, text: "Skills\nFirst private CV" });
  const job = await createJob(owner, startWithCv(first.uploadId), null);
  const second = await stageCvText(owner, upload("text.pdf"));
  expect(saved().cv!.metadata).toEqual(second);
  expect(saved().removedCvs.map(r => r.id)).toContain(first.uploadId);
  expect(saved().jobs.find(j => j.value.jobId === job.jobId)?.value.state).toBe("cancelled");
  expect(JSON.stringify(saved())).not.toContain("First private CV");
  await expect(createJob(owner, startWithCv(first.uploadId), null)).rejects.toMatchObject({ code: "cv_expired" });
  expect(await removeCv(owner, first.uploadId)).toEqual({ removed: true });
});

it("erases the extracted text when the CV expires", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const cv = await stageCvText(owner, upload("text.docx"));
  vi.setSystemTime(Date.now() + INPUT_TTL_MS);
  expect((await readPrivateState(owner)).pendingCv).toBeNull();
  expect(saved().cv).toBeNull();
  expect(JSON.stringify(saved())).not.toContain("Python");
  await expect(createJob(owner, startWithCv(cv.uploadId), null)).rejects.toMatchObject({ code: "cv_expired" });
});

it("keeps one owner's CV away from every other owner", async () => {
  const cv = await stageCvText(owner, upload("text.pdf"));
  expect((await readPrivateState("google:202")).pendingCv).toBeNull();
  await expect(removeCv("google:202", cv.uploadId)).rejects.toMatchObject({ status: 404 });
  await expect(createJob("google:202", startWithCv(cv.uploadId), null)).rejects.toMatchObject({ code: "cv_expired" });
  expect(saved().cv!.metadata).toEqual(cv);
});

/** A parse that finishes only when the test says so. */
function heldParse(text: string) {
  let release = () => {};
  const done = new Promise<void>((resolve) => (release = resolve));
  vi.mocked(extractCvText).mockImplementationOnce(async () => { await done; return { text, warnings: [] }; });
  return release;
}

it("drops a CV that finishes reading after the sources were confirmed without it", async () => {
  const release = heldParse("Late private CV text");
  const late = stageCvText(owner, upload("text.pdf"));
  await vi.waitFor(() => expect(extractCvText).toHaveBeenCalled());
  await createJob(owner, { ...startWithCv("unused"), cv: null }, null); // page two continued with CV off
  release();
  await expect(late).rejects.toMatchObject({ code: "consent_changed", status: 409 });
  expect(saved().cv).toBeNull();
  expect(JSON.stringify(saved())).not.toContain("Late private CV text");
});

it("never lets an older upload that finishes last replace a newer one or cancel its work", async () => {
  const release = heldParse("Older private CV text");
  const older = stageCvText(owner, upload("text.pdf"));
  await vi.waitFor(() => expect(extractCvText).toHaveBeenCalled());
  const newer = await stageCvText(owner, { consent: true, text: "Skills\nNewer CV" });
  release();
  await expect(older).rejects.toMatchObject({ code: "consent_changed" });
  expect(saved().cv).toEqual({ metadata: newer, text: "Skills\nNewer CV" });
  expect(JSON.stringify(saved())).not.toContain("Older private CV text");
  // And with work already started on the newer CV, a late older upload leaves it running.
  const releaseAgain = heldParse("Another late CV");
  const later = stageCvText(owner, upload("text.pdf"));
  await vi.waitFor(() => expect(extractCvText).toHaveBeenCalledTimes(2));
  const job = await createJob(owner, startWithCv(newer.uploadId), null);
  releaseAgain();
  await expect(later).rejects.toMatchObject({ code: "consent_changed" });
  expect(saved().jobs.find(j => j.value.jobId === job.jobId)?.value.state).toBe("queued");
  expect(saved().cv!.metadata).toEqual(newer);
});

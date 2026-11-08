import { readFileSync } from "node:fs";
import { beforeEach, expect, it, vi } from "vitest";
import { MAX_CV_BYTES } from "@/contracts/enrichment";
import { DEMO_GOOGLE_NEW } from "@/contracts/fixtures";
import type { OwnerData } from "@/server/profile/enrichment/model";

const mocks = vi.hoisted(() => ({ query: vi.fn(), userId: "google:101" as string | null, fakeApi: false, rows: new Map<string, { version: number; data: OwnerData }>() }));
vi.mock("@neondatabase/serverless", async original => ({ ...await original<typeof import("@neondatabase/serverless")>(), neon: () => ({ query: mocks.query }) }));
vi.mock("@/server/config", () => ({ config: { get fakeApi() { return mocks.fakeApi; }, fakeSearch: true, fakeAi: true, profileEnrichmentEnabled: true } }));
vi.mock("@/server/auth", () => ({ getUserId: async () => mocks.userId }));
vi.mock("next/server", async original => ({ ...await original<typeof import("next/server")>(), connection: async () => undefined }));
// The real parser and worker, watched so tests can tell whether parsing started.
vi.mock("@/server/profile/enrichment/cv-parser", async original => {
  const real = await original<typeof import("@/server/profile/enrichment/cv-parser")>();
  return { ...real, extractCvText: vi.fn(real.extractCvText) };
});
import { extractCvText } from "@/server/profile/enrichment/cv-parser";
import { POST as upload } from "./route";
import { POST as remove } from "./[id]/remove/route";

const PDF = "application/pdf";
const fixture = (name: string) => readFileSync(new URL(`../../../../server/profile/enrichment/fixtures/cv/${name}`, import.meta.url));
function form(fields: Record<string, string | File>) {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  return new Request("http://localhost/api/profile-enrichment/cv", { method: "POST", body });
}
const file = (name: string, type = PDF, bytes: Uint8Array<ArrayBuffer> = new Uint8Array(fixture(name))) => new File([bytes], name, { type });
const send = async (request: Request) => { const response = await upload(request, { params: Promise.resolve({}) }); return { status: response.status, body: await response.json() }; };
const stored = () => JSON.stringify([...mocks.rows.values()]);

beforeEach(() => {
  mocks.rows.clear(); mocks.userId = "google:101"; mocks.fakeApi = false; vi.mocked(extractCvText).mockClear();
  vi.stubEnv("DATABASE_URL", "postgresql://unused:unused@example.invalid/unused");
  // Versioned recorded database replies: no real database is contacted.
  mocks.query.mockReset().mockImplementation(async (statement: string, params: unknown[]) => {
    if (statement.startsWith("select")) {
      const row = mocks.rows.get(String(params[0])); return { rows: row ? [[String(params[0]), row.version, JSON.stringify(row.data), null]] : [] };
    }
    if (statement.startsWith("insert")) {
      const owner = String(params[0]); if (mocks.rows.has(owner)) return { rows: [] };
      mocks.rows.set(owner, { version: Number(params[1]), data: JSON.parse(String(params[2])) }); return { rows: [[owner]] };
    }
    if (statement.startsWith("update")) {
      const owner = String(params.at(-2)); if (mocks.rows.get(owner)?.version !== params.at(-1)) return { rows: [] };
      mocks.rows.set(owner, { version: Number(params[0]), data: JSON.parse(String(params[1])) }); return { rows: [[owner]] };
    }
    throw new Error("Unexpected query in recorded upload test");
  });
});

it("reads a consented PDF upload into private text and replies with metadata only", async () => {
  const warn = vi.spyOn(console, "warn");
  const reply = await send(form({ consent: "true", file: file("text.pdf") }));
  expect(reply).toMatchObject({ status: 200, body: { filename: "text.pdf", warnings: [] } });
  expect(Object.keys(reply.body).sort()).toEqual(["characters", "expiresAt", "filename", "uploadId", "warnings"]);
  expect(stored()).toContain("Example University: built data pipelines");
  expect(stored()).not.toContain("%PDF-");
  expect(warn).not.toHaveBeenCalled();
});

it("refuses before parsing or counting: signed out, no consent, too large, wrong type, two files", async () => {
  mocks.userId = null;
  expect((await send(form({ consent: "true", file: file("text.pdf") }))).status).toBe(401);
  mocks.userId = "google:101";
  expect(await send(form({ file: file("text.pdf") }))).toMatchObject({ status: 400, body: { code: "invalid_input" } });
  expect(await send(form({ consent: "false", file: file("text.pdf") }))).toMatchObject({ status: 400, body: { code: "invalid_input" } });
  const big = new Uint8Array(MAX_CV_BYTES + 1); big.set(fixture("text.pdf"));
  expect(await send(form({ consent: "true", file: file("big.pdf", PDF, big) }))).toMatchObject({ status: 413, body: { code: "cv_too_large" } });
  expect(await send(form({ consent: "true", file: file("text.pdf", "image/png") }))).toMatchObject({ status: 415, body: { code: "cv_unsupported" } });
  expect(await send(form({ consent: "true", file: file("text.pdf"), text: "Also pasted" }))).toMatchObject({ status: 400 });
  expect(extractCvText).not.toHaveBeenCalled();
  expect(mocks.rows.size).toBe(0);
});

it.each([
  ["encrypted.pdf", 422, "cv_encrypted"],
  ["scanned.pdf", 422, "cv_unreadable"],
  ["image.png", 415, "cv_unsupported"],
])("reports %s with its documented code and no document text", async (name, status, code) => {
  const reply = await send(form({ consent: "true", file: file(name) }));
  expect(reply).toEqual({ status, body: { error: expect.any(String), code } });
  expect(JSON.parse(stored())[0].data.cv).toBeNull();
});

it("keeps pasted text working and lets only the owner remove an upload", async () => {
  const pasted = await send(form({ consent: "true", text: "Skills: Rust" }));
  expect(pasted).toMatchObject({ status: 200, body: { filename: null, characters: 12 } });
  mocks.userId = "google:202";
  const foreign = await remove(new Request(`http://localhost/api/profile-enrichment/cv/${pasted.body.uploadId}/remove`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }),
    { params: Promise.resolve({ id: pasted.body.uploadId }) });
  expect(foreign.status).toBe(404);
  expect(stored()).toContain("Skills: Rust");
});

it("leaves the fake's recorded outcomes unchanged", async () => {
  mocks.fakeApi = true; mocks.userId = DEMO_GOOGLE_NEW;
  const long = new TextEncoder().encode("%PDF-1.7 DEMO:LONG");
  expect(await send(form({ consent: "true", file: file("long.pdf", PDF, long) }))).toMatchObject({ status: 200, body: { characters: 30_000, warnings: ["cv_truncated"] } });
  expect(extractCvText).not.toHaveBeenCalled();
  expect(mocks.rows.size).toBe(0);
});

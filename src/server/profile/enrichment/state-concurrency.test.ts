import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OwnerData } from "./model";
import type { RouteBody } from "@/contracts/routes";
import { enrichmentIdentity, enrichmentStart } from "@/contracts/fixtures/enrichment";

type Row = { version: number; data: unknown; sweep: unknown };
const mocks = vi.hoisted(() => ({ query: vi.fn(), rows: new Map<string, Row>(), writes: 0, lost: 0 }));
vi.mock("@neondatabase/serverless", async original => ({ ...await original<typeof import("@neondatabase/serverless")>(), neon: () => ({ query: mocks.query }) }));
import { cancelJob, claimJob, cleanupExpired, createJob, recordCollection, retryJob, saveIdentity, stageCvText } from "./state";
import { deferCleanup } from "./storage";

const owner = "google:101";
const active = (): RouteBody<"startEnrichment"> => ({ ...enrichmentStart(), github: { import: false, bio: false, repos: false, orgs: false },
  publicProfile: { kind: "text", text: "Private page input" } });
const doc = () => OwnerData.parse(mocks.rows.get(owner)!.data);
const edit = (change: (data: OwnerData) => void) => { const row = mocks.rows.get(owner)!; const data = doc(); change(data); row.data = data; row.version++; };
const evidence = () => [{ id: `${owner}:profile_page:x`, personId: owner, sourceId: `${owner}:public_profile`, source: "public_profile" as const,
  kind: "profile_page" as const, title: "Profile text", excerpt: "Collected private excerpt", retrievedAt: new Date().toISOString() }];

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "postgresql://unused:unused@example.invalid/unused");
  mocks.rows.clear(); mocks.writes = 0; mocks.lost = 0;
  mocks.query.mockReset().mockImplementation(async (statement: string, params: unknown[]) => {
    await new Promise(resolve => setImmediate(resolve)); // let the other request run up to its own query
    if (statement.startsWith("select") && statement.includes("<= now()"))
      return { rows: [...mocks.rows].filter(([, r]) => r.sweep !== null && Date.parse(String(r.sweep)) <= Date.now())
        .sort(([, a], [, b]) => Date.parse(String(a.sweep)) - Date.parse(String(b.sweep))).slice(0, Number(params[0])).map(([id]) => [id]) };
    if (statement.startsWith("select")) {
      const row = mocks.rows.get(String(params[0]));
      return { rows: row ? [[String(params[0]), row.version, JSON.stringify(row.data), row.sweep]] : [] };
    }
    if (statement.startsWith("insert")) {
      const id = String(params[0]); if (mocks.rows.has(id)) { mocks.lost++; return { rows: [] }; }
      mocks.writes++; mocks.rows.set(id, { version: Number(params[1]), data: JSON.parse(String(params[2])), sweep: params[3] ?? null }); return { rows: [[id]] };
    }
    if (statement.startsWith("update")) {
      if (!statement.includes('"document"')) {
        if (!statement.includes("<= now()")) throw new Error("Deferral must only update a due deadline");
        const row = mocks.rows.get(String(params[1]));
        if (row?.sweep && Date.parse(String(row.sweep)) <= Date.now()) row.sweep = params[0];
        return { rows: [] };
      }
      const id = String(params.at(-2)); const row = mocks.rows.get(id);
      if (row?.version !== params.at(-1)) { mocks.lost++; return { rows: [] }; }
      mocks.writes++; mocks.rows.set(id, { version: Number(params[0]), data: JSON.parse(String(params[1])), sweep: params.length > 4 ? params[2] : null }); return { rows: [[id]] };
    }
    throw new Error("Unexpected query: " + statement);
  });
});
afterEach(() => { vi.unstubAllEnvs(); });

it("two tabs starting at once: both saved, older superseded, only the live job keeps input", async () => {
  const [a, b] = await Promise.all([createJob(owner, active(), null), createJob(owner, active(), null)]);
  expect(mocks.lost).toBeGreaterThan(0); // the race really happened
  const jobs = doc().jobs;
  expect(jobs.map(j => j.value.jobId).sort()).toEqual([a.jobId, b.jobId].sort());
  expect(jobs.map(j => j.value.state)).toEqual(["superseded", "queued"]);
  expect(jobs.filter(j => j.input !== null)).toHaveLength(1);
});

it("the same key sent twice at once returns one job", async () => {
  const body = active();
  const [a, b] = await Promise.all([createJob(owner, body, null), createJob(owner, structuredClone(body), null)]);
  expect(mocks.lost).toBeGreaterThan(0);
  expect(a.jobId).toBe(b.jobId); expect(doc().jobs).toHaveLength(1);
});

it.each(["cancel first", "worker first"])("cancel racing a worker's write (%s) leaves no collected/private text", async order => {
  const job = await createJob(owner, active(), null); const lease = await claimJob(owner, job.jobId);
  const progress = lease.value.sources.map(s => s.source === "public_profile" ? { ...s, status: "done" as const, items: 1 } : s);
  const ops = [() => cancelJob(owner, job.jobId), () => recordCollection(owner, job.jobId, lease.token, progress, evidence())];
  await Promise.allSettled((order === "cancel first" ? ops : ops.reverse()).map(op => op()));
  expect(mocks.lost).toBeGreaterThan(0);
  expect(doc().jobs[0].value.state).toBe("cancelled");
  expect(JSON.stringify(mocks.rows.get(owner)!.data)).not.toMatch(/Collected private excerpt|Private page input/);
});

it("two uploads at once keep exactly one CV: an older one either lands first and is replaced, or is refused", async () => {
  const texts = ["First racing CV", "Second racing CV"];
  const results = await Promise.allSettled(texts.map(text => stageCvText(owner, { consent: true, text })));
  expect(mocks.lost).toBeGreaterThan(0);
  const saved = doc(); const kept = saved.cv!.metadata.uploadId;
  const staged = results.flatMap(r => r.status === "fulfilled" ? [r.value.uploadId] : []);
  expect(staged).toContain(kept);
  for (const r of results) if (r.status === "rejected") expect(r.reason).toMatchObject({ code: "consent_changed" });
  // Only the kept CV's text remains; one that landed and was replaced leaves a removal tombstone.
  expect(texts.filter(t => JSON.stringify(saved).includes(t))).toHaveLength(1);
  for (const id of staged.filter(id => id !== kept)) expect(saved.removedCvs.map(r => r.id)).toContain(id);
});

it("an expired worker cannot write after retry and a new claim (fencing by token)", async () => {
  const job = await createJob(owner, active(), null); const first = await claimJob(owner, job.jobId);
  edit(d => { d.jobs[0].lease!.expiresAt = Date.now() - 1; });
  await retryJob(owner, job.jobId); const second = await claimJob(owner, job.jobId);
  const progress = (t: typeof first) => t.value.sources.map(s => s.source === "public_profile" ? { ...s, status: "done" as const, items: 1 } : s);
  const [old, current] = await Promise.allSettled([recordCollection(owner, job.jobId, first.token, progress(first), evidence()),
    recordCollection(owner, job.jobId, second.token, progress(second), evidence())]);
  expect(old).toMatchObject({ status: "rejected", reason: { code: "draft_superseded" } });
  expect(current.status).toBe("fulfilled");
});

it("identity change racing a start never leaves a live job with the old identity", async () => {
  await saveIdentity(owner, enrichmentIdentity);
  await Promise.allSettled([saveIdentity(owner, { ...enrichmentIdentity, name: "Newer" }), createJob(owner, active(), null)]);
  const saved = doc();
  for (const job of saved.jobs) if (!["superseded", "cancelled"].includes(job.value.state)) expect(job.input?.identity).toEqual(saved.identity);
  expect(saved.jobs.filter(j => j.value.state === "superseded").every(j => j.input === null)).toBe(true);
});

it("defers an unreadable row while purging another owner's expired CV text", async () => {
  const past = new Date(Date.now() - 1000).toISOString();
  mocks.rows.set("google:bad", { version: 1, data: { identity: "unreadable" }, sweep: past }); // due first
  await stageCvText(owner, { consent: true, text: "Other owner's expired CV" });
  edit(d => { d.cv!.metadata.expiresAt = past; });
  mocks.rows.get(owner)!.sweep = past;
  expect(await cleanupExpired()).toEqual({ processed: 1, failed: 1 });
  expect(JSON.stringify(mocks.rows.get(owner)!.data)).not.toContain("Other owner's expired CV");
  expect(mocks.rows.get("google:bad")!.data).toEqual({ identity: "unreadable" });
  expect(Date.parse(String(mocks.rows.get("google:bad")!.sweep))).toBeGreaterThan(Date.now());
  expect(await cleanupExpired()).toEqual({ processed: 0, failed: 0 });
});

it("cleanup physically drops expired CV text and does not leave the row due forever", async () => {
  await stageCvText(owner, { consent: true, text: "Expired private CV" });
  edit(d => { d.cv!.metadata.expiresAt = new Date(Date.now() - 1000).toISOString(); });
  mocks.rows.get(owner)!.sweep = new Date(Date.now() - 1000).toISOString();
  expect(await cleanupExpired()).toEqual({ processed: 1, failed: 0 });
  expect(JSON.stringify(mocks.rows.get(owner)!.data)).not.toContain("Expired private CV");
  const sweep = mocks.rows.get(owner)!.sweep;
  expect(sweep === null || Date.parse(String(sweep)) > Date.now()).toBe(true);
});

it("moves a full batch of unreadable rows aside so the next batch can erase expired text", async () => {
  const past = new Date(Date.now() - 1000).toISOString();
  for (let i = 0; i < 25; i++) mocks.rows.set(`google:bad${i}`, { version: 1, data: {}, sweep: past });
  await stageCvText(owner, { consent: true, text: "CV behind failed batch" });
  edit(d => { d.cv!.metadata.expiresAt = past; });
  mocks.rows.get(owner)!.sweep = past;
  expect(await cleanupExpired()).toEqual({ processed: 0, failed: 25 });
  expect(await cleanupExpired()).toEqual({ processed: 1, failed: 0 });
  expect(JSON.stringify(mocks.rows.get(owner)!.data)).not.toContain("CV behind failed batch");
});

it("continues cleanup if deferring a failed row also fails", async () => {
  const past = new Date(Date.now() - 1000).toISOString();
  await stageCvText(owner, { consent: true, text: "CV after storage failure" });
  edit(d => { d.cv!.metadata.expiresAt = past; });
  mocks.rows.get(owner)!.sweep = past;
  const query = mocks.query.getMockImplementation()!;
  mocks.query.mockImplementation(async (statement: string, params: unknown[]) => {
    if (statement.startsWith("update") && !statement.includes('"document"')) throw new Error("private-provider-error");
    return query(statement, params);
  });
  mocks.rows.set("google:bad", { version: 1, data: {}, sweep: new Date(Date.now() - 2000).toISOString() });
  expect(await cleanupExpired()).toEqual({ processed: 1, failed: 1 });
  expect(JSON.stringify(mocks.rows.get(owner)!.data)).not.toContain("CV after storage failure");
});

it("does not replace a cleanup deadline already moved forward by another request", async () => {
  const future = new Date(Date.now() + 3_600_000).toISOString();
  mocks.rows.set(owner, { version: 4, data: {}, sweep: future });
  await deferCleanup(owner);
  expect(mocks.rows.get(owner)).toEqual({ version: 4, data: {}, sweep: future });
});

/**
 * The scheduled cleanup route over the real cleanup kernel (state.ts) with an in-memory stand-in for
 * Postgres storage that keeps storage.ts's contract: unchanged documents are not rewritten, due owners
 * come oldest deadline first in batches of 25, a deferral moves only a due row, and a saved change
 * deletes the job's discarded synthesis cache keys with it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cacheKeys, emptyOwnerData, INPUT_TTL_MS, OwnerData, profileCachePrefix } from "@/server/profile/enrichment/model";

type Row = { document: OwnerData; nextSweepAt: number | null };
const db = vi.hoisted(() => ({
  rows: new Map<string, Row>(),
  cache: new Set<string>(),
  failing: new Set<string>(), // owners whose save fails, as in a storage outage for that row
  calls: 0, // every storage call, to prove refused requests touch nothing
  listFails: false,
  listTakesMs: 0, // fake time each due-owner listing takes, to reach the time budget
}));
const connection = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("next/server", () => ({ connection }));
vi.mock("@/server/profile/enrichment/storage", async (actual) => {
  const real = await actual<typeof import("@/server/profile/enrichment/storage")>();
  const { StateError } = await import("@/server/profile/enrichment/model");
  return {
    ...real,
    async mutateOwner<T>(owner: string, change: (data: OwnerData) => T): Promise<T> {
      db.calls++;
      if (db.failing.has(owner)) throw new StateError("provider_down", 503);
      const row = db.rows.get(owner);
      const data = structuredClone(row?.document ?? emptyOwnerData());
      const before = row ? JSON.stringify(data) : null;
      const result = change(data);
      const checked = OwnerData.parse(data);
      if (before === JSON.stringify(checked)) return structuredClone(result); // as storage.ts: no write, no new deadline
      const removed = row ? cacheKeys(row.document).filter((key) => !cacheKeys(checked).includes(key)) : [];
      for (const key of removed) if (key.startsWith(profileCachePrefix(owner))) db.cache.delete(key);
      db.rows.set(owner, { document: checked, nextSweepAt: real.nextSweepAt(checked)?.getTime() ?? null });
      return structuredClone(result);
    },
    async ownersDueForCleanup(limit = 25): Promise<string[]> {
      db.calls++;
      if (db.listFails) throw new StateError("provider_down", 503);
      if (db.listTakesMs) vi.setSystemTime(Date.now() + db.listTakesMs);
      return [...db.rows].filter(([, row]) => row.nextSweepAt !== null && row.nextSweepAt <= Date.now())
        .sort(([, a], [, b]) => a.nextSweepAt! - b.nextSweepAt!).slice(0, limit).map(([owner]) => owner);
    },
    async deferCleanup(owner: string): Promise<void> {
      db.calls++;
      const row = db.rows.get(owner);
      if (row && row.nextSweepAt !== null && row.nextSweepAt <= Date.now()) row.nextSweepAt = Date.now() + 600_000;
    },
  };
});

import { createJob, stageCvText } from "@/server/profile/enrichment/state";
import { enrichmentStart } from "@/contracts/fixtures/enrichment";

const SECRET = "test-cron-secret-0123456789";
const start = new Date("2026-11-08T03:00:00Z").getTime();
let GET: typeof import("./route").GET;

async function load(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  GET = (await import("./route")).GET;
}
const call = (authorization?: string) =>
  GET(new Request("https://lanyard.example/api/cron/enrichment-cleanup", authorization === undefined ? {} : { headers: { authorization } }));
const authorized = () => call(`Bearer ${SECRET}`);
async function body(response: Response) {
  const text = await response.text();
  return { status: response.status, json: JSON.parse(text) as Record<string, unknown>, text, cache: response.headers.get("cache-control") };
}

/** A pending CV staged now: private text that expires in 24 hours. */
const stageCv = (owner: string) => stageCvText(owner, { consent: true, text: `Private CV text for ${owner}` });
/** A queued job that cached a synthesis proposal; the job and its cache expire with its input. */
async function jobWithCache(owner: string) {
  await createJob(owner, { ...enrichmentStart(), github: { import: false, bio: false, repos: false, orgs: false }, publicProfile: { kind: "text", text: "Private page text" } }, null);
  const key = `${profileCachePrefix(owner)}recorded`;
  db.rows.get(owner)!.document.jobs[0].synthesisCacheKeys = [key];
  db.cache.add(key);
  return key;
}

beforeEach(async () => {
  vi.useFakeTimers({ now: start, toFake: ["Date"] });
  db.rows.clear(); db.cache.clear(); db.failing.clear(); db.calls = 0; db.listFails = false; db.listTakesMs = 0;
  await load({ CRON_SECRET: SECRET, PROFILE_ENRICHMENT_ENABLED: "0", FAKE_API: undefined });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("refusing requests before touching storage", () => {
  it("fails closed when the secret is not configured", async () => {
    await stageCv("google:1");
    db.calls = 0;
    for (const unset of [undefined, ""]) {
      await load({ CRON_SECRET: unset });
      const result = await body(await call(`Bearer ${SECRET}`));
      expect(result).toMatchObject({ status: 503, json: { status: "not_configured" }, cache: "no-store" });
    }
    expect(db.calls).toBe(0);
    expect(connection).toHaveBeenCalled(); // request-time only, never prerendered
  });

  it.each([
    ["no header", undefined],
    ["a wrong secret", "Bearer wrong-secret-0123456789"],
    ["the secret without Bearer", SECRET],
    ["a different scheme", `Basic ${SECRET}`],
    ["a longer secret", `Bearer ${SECRET}x`],
    ["an empty bearer", "Bearer "],
  ])("rejects %s with 401", async (_case, header) => {
    const result = await body(await call(header));
    expect(result).toMatchObject({ status: 401, json: { status: "unauthorized" }, cache: "no-store" });
    expect(db.calls).toBe(0);
  });
});

describe("authorized cleanup", () => {
  it("removes expired private input and its cache, keeps unexpired input, and reports counts only", async () => {
    await stageCv("google:expired-cv");
    const key = await jobWithCache("google:expired-job");
    vi.setSystemTime(start + 23 * 3_600_000);
    await stageCv("google:fresh-cv"); // staged an hour before cleanup: 23 hours left
    vi.setSystemTime(start + INPUT_TTL_MS + 60_000);
    const logs = (["log", "info", "warn", "error", "debug"] as const).map((level) => vi.spyOn(console, level));

    const result = await body(await authorized());

    expect(result).toMatchObject({ status: 200, cache: "no-store",
      json: { status: "complete", processed: 2, failed: 0, batches: 2, stoppedEarly: false } });
    expect(db.rows.get("google:expired-cv")!.document.cv).toBeNull();
    const job = db.rows.get("google:expired-job")!.document.jobs[0];
    expect(job).toMatchObject({ input: null, collected: [], value: { state: "failed" } });
    expect(db.cache.has(key)).toBe(false);
    expect(db.rows.get("google:fresh-cv")!.document.cv?.text).toBe("Private CV text for google:fresh-cv");
    // No owner ID or private text in the response, and nothing logged.
    expect(result.text).not.toMatch(/google:|Private/);
    for (const spy of logs) expect(spy).not.toHaveBeenCalled();
  });

  it("does nothing and reports nothing processed when run again", async () => {
    await stageCv("google:1");
    vi.setSystemTime(start + INPUT_TTL_MS + 60_000);
    expect((await body(await authorized())).json).toMatchObject({ status: "complete", processed: 1 });
    const writes = db.rows.get("google:1");
    const again = await body(await authorized());
    expect(again).toMatchObject({ status: 200, json: { status: "complete", processed: 0, failed: 0, batches: 1 } });
    expect(db.rows.get("google:1")).toBe(writes);
  });

  it("works with profile enrichment switched off", async () => {
    await load({ CRON_SECRET: SECRET, PROFILE_ENRICHMENT_ENABLED: undefined });
    await stageCv("google:1");
    vi.setSystemTime(start + INPUT_TTL_MS + 60_000);
    expect((await body(await authorized())).json).toMatchObject({ status: "complete", processed: 1 });
    expect(db.rows.get("google:1")!.document.cv).toBeNull();
  });

  it("clears more than one batch of due owners in a run", async () => {
    for (let i = 0; i < 60; i++) await stageCv(`google:${i}`);
    vi.setSystemTime(start + INPUT_TTL_MS + 60_000);
    const result = await body(await authorized());
    expect(result.json).toMatchObject({ status: "complete", processed: 60, failed: 0, batches: 4 });
    expect([...db.rows.values()].every((row) => row.document.cv === null)).toBe(true);
  });
});

describe("partial failures", () => {
  it("reports an owner that couldn't be cleaned, defers it, and still cleans the rest", async () => {
    await stageCv("google:ok");
    await stageCv("google:broken");
    vi.setSystemTime(start + INPUT_TTL_MS + 60_000);
    db.failing.add("google:broken");

    const result = await body(await authorized());

    expect(result).toMatchObject({ status: 500, json: { status: "partial", processed: 1, failed: 1, stoppedEarly: false } });
    expect(result.text).not.toContain("google:");
    expect(db.rows.get("google:ok")!.document.cv).toBeNull();
    expect(db.rows.get("google:broken")!.nextSweepAt).toBe(Date.now() + 600_000); // retried after ten minutes
  });

  it("reports storage that can't list due owners as failed, with what was done so far", async () => {
    await stageCv("google:1");
    vi.setSystemTime(start + INPUT_TTL_MS + 60_000);
    db.listFails = true;
    const result = await body(await authorized());
    expect(result).toMatchObject({ status: 503, json: { status: "failed", processed: 0, failed: 0 } });
    expect(result.text).not.toMatch(/provider|google:/);
  });

  it("stops starting batches at its time budget and says work may remain", async () => {
    for (let i = 0; i < 100; i++) await stageCv(`google:${i}`);
    vi.setSystemTime(start + INPUT_TTL_MS + 60_000);
    const begun = Date.now();
    db.listTakesMs = 20_000;

    const result = await body(await authorized());

    expect(result).toMatchObject({ status: 500, json: { status: "partial", failed: 0, stoppedEarly: true } });
    expect(Number(result.json.processed)).toBeLessThan(100);
    expect(Date.now() - begun).toBeLessThan(60_000); // inside the route's 60-second limit
    expect([...db.rows.values()].some((row) => row.document.cv !== null)).toBe(true); // left for the next run
  });
});

describe("the schedule", () => {
  it("calls this route once a day, the most often every Vercel plan allows", async () => {
    const { readFileSync, existsSync } = await import("node:fs");
    const vercel = JSON.parse(readFileSync(new URL("../../../../../vercel.json", import.meta.url), "utf8")) as { crons: { path: string; schedule: string }[] };
    const cron = vercel.crons.find((c) => c.path === "/api/cron/enrichment-cleanup");
    expect(cron).toBeDefined();
    expect(existsSync(new URL("./route.ts", import.meta.url))).toBe(true);
    // Fixed minute and hour, every day: Hobby rejects anything more frequent at deployment.
    expect(cron!.schedule).toMatch(/^\d{1,2} \d{1,2} \* \* \*$/);
  });
});

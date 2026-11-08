import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { emptyOwnerData, INPUT_TTL_MS, JOB_HISTORY_MS } from "./model";
const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@neondatabase/serverless", async original => ({ ...await original<typeof import("@neondatabase/serverless")>(), neon: () => ({ query: mocks.query }) }));
import { mutateOwner, ownersDueForCleanup, readOwner } from "./storage";
const owner = "google:101";
function row(version = 1, generation = 0) {
  return { rows: [[owner, version, JSON.stringify({ ...emptyOwnerData(), generation }), null]] };
}
beforeEach(() => { mocks.query.mockReset(); vi.stubEnv("DATABASE_URL", "postgresql://unused:unused@example.invalid/unused"); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
it("reads an owner's state for idempotency without initializing or modifying it", async () => {
  mocks.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce(row());
  expect(await readOwner(owner)).toBeUndefined(); expect(await readOwner(owner)).toMatchObject({ generation: 0 });
  expect(mocks.query.mock.calls).toHaveLength(2);
  for (const [statement, parameters] of mocks.query.mock.calls) {
    expect(statement).toMatch(/^select/); expect(parameters).toEqual([owner, 1]);
  }
});
it("sanitizes unreadable idempotency state and does not initialize it", async () => {
  mocks.query.mockRejectedValueOnce(new Error("private text and credentials"));
  await expect(readOwner(owner)).rejects.toMatchObject({ status: 503, code: "provider_down" });
  expect(mocks.query).toHaveBeenCalledTimes(1);
});
it("creates owner-private Postgres state rather than retaining it in an instance", async () => {
  mocks.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [[owner]] });
  expect(await mutateOwner(owner, data => ++data.generation)).toBe(1);
  expect(mocks.query.mock.calls[0][0]).toContain('where "profile_enrichment_states"."user_id" = $1');
  expect(mocks.query.mock.calls[0][1]).toEqual([owner,1]);
  expect(mocks.query.mock.calls[1][0]).toContain("on conflict do nothing");
  expect(mocks.query.mock.calls[1][1][0]).toBe(owner);
});
it("re-reads after a concurrent write and applies its change to the newer document", async () => {
  mocks.query.mockResolvedValueOnce(row()).mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce(row(2,5)).mockResolvedValueOnce({ rows: [[owner]] });
  expect(await mutateOwner(owner, data => ++data.generation)).toBe(6);
  const [statement, parameters] = mocks.query.mock.calls[3];
  expect(statement).toContain('"profile_enrichment_states"."version" =');
  expect(JSON.parse(parameters[1]).generation).toBe(6);
  expect(parameters.slice(-2)).toEqual([owner,2]);
});
it("retries a competing first insert without overwriting its data", async () => {
  mocks.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce(row(1,3)).mockResolvedValueOnce({ rows: [[owner]] });
  expect(await mutateOwner(owner, data => ++data.generation)).toBe(4);
});
it("bounds contention retries and returns a retryable conflict", async () => {
  mocks.query.mockImplementation(async (query: string) => query.startsWith("select") ? row() : { rows: [] });
  await expect(mutateOwner(owner, data => ++data.generation)).rejects.toMatchObject({ code: "running", status: 409, retryAfterSeconds: 1 });
  expect(mocks.query).toHaveBeenCalledTimes(10);
});
it("does not expose SQL parameters or provider errors when storage fails", async () => {
  mocks.query.mockRejectedValueOnce(new Error("private CV text and database-password"));
  try { await mutateOwner(owner, () => undefined); throw new Error("Expected rejection"); }
  catch (error) { expect(error).toMatchObject({ status: 503, code: "provider_down" }); expect(String(error)).not.toMatch(/CV text|database-password/); expect(error).not.toHaveProperty("cause"); }
});
it("rejects a corrupt stored document instead of silently resetting consent and jobs", async () => {
  mocks.query.mockResolvedValueOnce({ rows: [[owner,1,'{"identity":"corrupt"}',null]] });
  await expect(mutateOwner(owner, () => undefined)).rejects.toMatchObject({ status: 503 });
  expect(mocks.query).toHaveBeenCalledOnce();
});
it("schedules cleanup for private-input expiry", async () => {
  mocks.query.mockResolvedValueOnce(row()).mockResolvedValueOnce({ rows: [[owner]] });
  const expiresAt = new Date(Date.now()+INPUT_TTL_MS).toISOString();
  await mutateOwner(owner, data => { data.cv = { text: "private", metadata: { uploadId:crypto.randomUUID(),filename:null,characters:7,warnings:[],expiresAt } }; });
  expect(mocks.query.mock.calls[1][1]).toContain(expiresAt);
});
it("uses the metadata-retention deadline after inputs are removed, avoiding an endlessly due row", async () => {
  mocks.query.mockResolvedValueOnce(row()).mockResolvedValueOnce({ rows: [[owner]] });
  const expiresAt = new Date().toISOString();
  await mutateOwner(owner, data => { data.jobs.push({ key:crypto.randomUUID(),fingerprint:"hash",input:null,collected:[],lease:null,
    value:{jobId:"cancelled",state:"cancelled",phase:"done",selectionGeneration:0,draft:null,expiresAt,
      sources:(["github","research","public_profile","cv"] as const).map(source=>({source,sourceId:source,status:"not_selected",items:0,selection:null}))} }); });
  expect(mocks.query.mock.calls[1][1]).toContain(new Date(Date.parse(expiresAt)+JOB_HISTORY_MS-INPUT_TTL_MS).toISOString());
});
it("finds a bounded cleanup batch and sanitizes cleanup lookup errors", async () => {
  mocks.query.mockResolvedValueOnce({ rows: [[owner]] });
  expect(await ownersDueForCleanup(999)).toEqual([owner]);
  expect(mocks.query.mock.calls[0][1]).toEqual([100]);
  mocks.query.mockRejectedValueOnce(new Error("private-database-error"));
  await expect(ownersDueForCleanup()).rejects.toMatchObject({ code: "provider_down" });
});

it("sanitizes provider errors even when they contain their own status/code fields", async () => {
  mocks.query.mockRejectedValueOnce(Object.assign(new Error("private-query-parameters"), { status:409,code:"foreign-provider-code" }));
  await expect(mutateOwner(owner, () => undefined)).rejects.toMatchObject({ status:503,code:"provider_down" });
});
it("does not rewrite private input during a status poll when no state expired", async () => {
  mocks.query.mockResolvedValueOnce(row());
  expect(await mutateOwner(owner, data => data.generation)).toBe(0);
  expect(mocks.query).toHaveBeenCalledOnce();
});
it("deletes discarded synthesis cache keys in the same version-guarded statement", async () => {
  const data = emptyOwnerData();
  data.jobs.push({ key:crypto.randomUUID(),fingerprint:"hash",input:null,collected:[],lease:null,synthesisCacheKeys:["profile:owner:hash"],
    value:{jobId:"job",state:"cancelled",phase:"done",selectionGeneration:0,draft:null,expiresAt:new Date().toISOString(),
      sources:(["github","research","public_profile","cv"] as const).map(source=>({source,sourceId:source,status:"not_selected",items:0,selection:null}))} });
  mocks.query.mockResolvedValueOnce({rows:[[owner,1,JSON.stringify(data),null]]}).mockResolvedValueOnce({rows:[{userId:owner}]});
  await mutateOwner(owner, state=>{delete state.jobs[0].synthesisCacheKeys;});
  const [statement,params]=mocks.query.mock.calls[1];
  expect(statement).toContain('delete from "ai_cache"'); expect(statement).toContain("exists (select 1 from saved)");
  expect(params).toContain(JSON.stringify(["profile:owner:hash"]));
});
it("rewrites a stale cleanup deadline even when the document itself is unchanged", async () => {
  // Due since yesterday, but nothing in the document expires: without a rewrite the row is picked first forever.
  const stale = new Date(Date.now() - 86_400_000).toISOString();
  mocks.query.mockResolvedValueOnce({ rows: [[owner, 3, JSON.stringify(emptyOwnerData()), stale]] }).mockResolvedValueOnce({ rows: [[owner]] });
  await mutateOwner(owner, () => undefined);
  expect(mocks.query).toHaveBeenCalledTimes(2);
  const [statement, parameters] = mocks.query.mock.calls[1];
  expect(statement).toMatch(/^update "profile_enrichment_states" set .*"next_sweep_at" = \$\d+/);
  expect(parameters).toContain(null); // nothing left to expire: no deadline
  expect(parameters.slice(-2)).toEqual([owner, 3]); // version-guarded like every write
});
it("leaves an unchanged row with a correct deadline untouched", async () => {
  const deadline = new Date(Date.now() + INPUT_TTL_MS);
  const data = { ...emptyOwnerData(), cv: { metadata: { uploadId: "u", filename: null, characters: 1, warnings: [], expiresAt: deadline.toISOString() }, text: "x" } };
  mocks.query.mockResolvedValueOnce({ rows: [[owner, 3, JSON.stringify(data), deadline.toISOString()]] });
  await mutateOwner(owner, () => undefined);
  expect(mocks.query).toHaveBeenCalledTimes(1);
});

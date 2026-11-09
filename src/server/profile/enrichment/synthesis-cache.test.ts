import { beforeEach, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({query:vi.fn()}));
vi.mock("@neondatabase/serverless",async original=>({...await original<typeof import("@neondatabase/serverless")>(),neon:()=>({query:mocks.query})}));
import { readSynthesisCache, writeSynthesisCache } from "./synthesis-cache";
import { profileCachePrefix } from "./model";
const key=profileCachePrefix("owner")+"hash";
beforeEach(()=>{vi.stubEnv("DATABASE_URL","postgresql://unused:unused@example.invalid/unused");mocks.query.mockReset().mockResolvedValue({rows:[]});});
it("reads a cache entry only through the current owner's live lease and unexpired entry",async()=>{
  mocks.query.mockResolvedValue({rows:[{value:{bio:"Professional work"}}]});
  expect(await readSynthesisCache("owner","job","token",key)).toEqual({bio:"Professional work"});
  const [sql,params]=mocks.query.mock.calls[0];
  expect(sql).toContain("for update of s"); expect(sql).toContain("selectionGeneration");
  expect(sql).toContain("created_at > now() - interval '24 hours'");
  expect(params).toEqual(expect.arrayContaining(["owner","job","token",key]));
});
it("remembers a cache key and inserts its validated reply in one fenced statement",async()=>{
  await writeSynthesisCache("owner","job","token",key,{bio:"Professional work"});
  const [sql]=mocks.query.mock.calls[0]; expect(sql).toContain("synthesisCacheKeys");
  expect(sql).toContain('insert into "ai_cache"'); expect(sql).toContain("from remembered");
  const afterLock=sql.split("from leased l where")[1];
  expect(afterLock).toContain("clock_timestamp()");expect(afterLock).toContain("'lease', 'token'");
  expect(afterLock).toContain("'cv', 'uploadId'");expect(afterLock).toContain("'{cv,metadata,expiresAt}'");
});
it("treats a cache outage as a miss without exposing provider errors",async()=>{
  mocks.query.mockRejectedValue(new Error("private contact text and database-password"));
  expect(await readSynthesisCache("owner","job","token",key)).toBeUndefined();
  await expect(writeSynthesisCache("owner","job","token",key,{})).resolves.toBeUndefined();
});
it("rejects another owner's cache namespace without reading or writing it",async()=>{
  expect(await readSynthesisCache("other","job","token",key)).toBeUndefined();
  await writeSynthesisCache("other","job","token",key,{}); expect(mocks.query).not.toHaveBeenCalled();
});

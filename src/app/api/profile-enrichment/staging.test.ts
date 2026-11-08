import { beforeEach, expect, it, vi } from "vitest";
import { emptyOwnerData, OwnerData } from "@/server/profile/enrichment/model";
import { enrichmentIdentity, enrichmentStart } from "@/contracts/fixtures/enrichment";
const mocks = vi.hoisted(()=>({query:vi.fn(),identity:{userId:"google:101" as string|null},rows:new Map<string,{version:number;data:OwnerData}>()}));
vi.mock("@neondatabase/serverless",async original=>({...await original<typeof import("@neondatabase/serverless")>(),neon:()=>({query:mocks.query})}));
vi.mock("@/server/config",()=>({config:{fakeApi:false,fakeSearch:true,fakeAi:true,profileEnrichmentEnabled:true}}));
vi.mock("@/server/auth",()=>({getUserId:async()=>mocks.identity.userId}));
vi.mock("@/server/profile/connection",()=>({accountState:async()=>"google",beginGitHubConnection:vi.fn()}));
vi.mock("@/server/profile/identities",()=>({readAccountState:async()=>({signIn:{provider:"google"},github:{connected:false,login:null},onboarded:false})}));
vi.mock("next/server",async original=>({...await original<typeof import("next/server")>(),connection:async()=>undefined}));
import { GET as state, PUT as save, POST as start } from "./route";
import { POST as upload } from "./cv/route";
import { POST as remove } from "./cv/[id]/remove/route";
import { GET as getJob } from "./[id]/route";
import { POST as cancel } from "./[id]/cancel/route";
const ctx=(id="")=>({params:Promise.resolve({id})});
const request=(body:unknown,method="POST")=>new Request("http://localhost/api/profile-enrichment",{method,headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
beforeEach(()=>{
  mocks.rows.clear();mocks.identity.userId="google:101";vi.stubEnv("DATABASE_URL","postgresql://unused:unused@example.invalid/unused");
  // Versioned recorded database responses: no provider or real database is contacted.
  mocks.query.mockReset().mockImplementation(async(statement:string,params:unknown[])=>{
    if(statement.startsWith("select")){
      const row=mocks.rows.get(String(params[0]));return{rows:row?[[String(params[0]),row.version,JSON.stringify(row.data),null]]:[]};
    }
    if(statement.startsWith("insert")){
      const owner=String(params[0]);if(mocks.rows.has(owner))return{rows:[]};
      mocks.rows.set(owner,{version:Number(params[1]),data:JSON.parse(String(params[2]))});return{rows:[[owner]]};
    }
    if(statement.startsWith("update")){
      const owner=String(params.at(-2));if(mocks.rows.get(owner)?.version!==params.at(-1))return{rows:[]};
      mocks.rows.set(owner,{version:Number(params[0]),data:JSON.parse(String(params[1]))});return{rows:[[owner]]};
    }
    throw new Error("Unexpected query in recorded staging test");
  });
});
it("saves private answers and pasted CV through real handlers while responses contain metadata only",async()=>{
  expect((await save(request(enrichmentIdentity,"PUT"),ctx())).status).toBe(200);
  const form=new FormData();form.set("text","Secret CV text");form.set("consent","true");
  const response=await upload(new Request("http://localhost/api/profile-enrichment/cv",{method:"POST",body:form}),ctx());
  expect(response.status).toBe(200);const cv=await response.json();
  expect(cv).toMatchObject({filename:null,characters:14});expect(JSON.stringify(cv)).not.toContain("Secret CV text");
  const visible=await(await state(new Request("http://localhost/api/profile-enrichment"),ctx())).json();
  expect(visible).toMatchObject({identity:enrichmentIdentity,pendingCv:{uploadId:cv.uploadId},signIn:{provider:"google"}});
  expect(JSON.stringify(visible)).not.toContain("Secret CV text");
  expect(mocks.rows.get("google:101")?.data.cv?.text).toBe("Secret CV text");
  expect((await remove(request({}),ctx(cv.uploadId))).status).toBe(200);
  expect((await remove(request({}),ctx(cv.uploadId))).status).toBe(200);
});
it("persists a real manual job, hides it from another owner, and cancels it idempotently",async()=>{
  const body=enrichmentStart();body.github.import=false;
  const response=await start(request(body),ctx());expect(response.status).toBe(200);const job=await response.json();
  expect(job).toMatchObject({state:"manual",draft:null});
  expect((await getJob(new Request("http://localhost/api/profile-enrichment/"+job.jobId),ctx(job.jobId))).status).toBe(200);
  mocks.identity.userId="google:other";
  expect((await getJob(new Request("http://localhost/api/profile-enrichment/"+job.jobId),ctx(job.jobId))).status).toBe(404);
  mocks.identity.userId="google:101";
  expect((await cancel(request({}),ctx(job.jobId))).status).toBe(200);
  expect((await cancel(request({}),ctx(job.jobId))).status).toBe(200);
});
it("does not create a phantom queued job when collection is unavailable",async()=>{
  const response=await start(request(enrichmentStart()),ctx());expect(response.status).toBe(501);
  expect(await response.json()).toMatchObject({code:"not_ready"});expect(mocks.rows.size).toBe(0);
});
it("returns a sanitized retryable error on a database outage",async()=>{
  mocks.query.mockRejectedValueOnce(new Error("Private CV database credential"));
  const warning=vi.spyOn(console,"warn").mockImplementation(()=>undefined);
  const response=await state(new Request("http://localhost/api/profile-enrichment"),ctx());
  expect(response.status).toBe(503);expect(await response.json()).toMatchObject({code:"provider_down"});
  expect(JSON.stringify(warning.mock.calls)).not.toMatch(/Private CV|credential/);warning.mockRestore();
});
it("keeps failed foreign lookups from creating state for another owner",async()=>{
  mocks.rows.set("google:101",{version:1,data:emptyOwnerData()});mocks.identity.userId="google:other";
  expect((await remove(request({}),ctx(crypto.randomUUID()))).status).toBe(404);
  expect(mocks.rows.has("google:other")).toBe(false);
});
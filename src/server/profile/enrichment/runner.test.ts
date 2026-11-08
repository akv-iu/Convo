import { beforeEach, expect, it, vi } from "vitest";
import { enrichmentStart } from "@/contracts/fixtures/enrichment";
import { emptyOwnerData, OwnerData, StateError } from "./model";
const mocks=vi.hoisted(()=>({data:null as OwnerData|null,github:vi.fn(),research:vi.fn(),page:vi.fn(),synthesis:vi.fn()}));
vi.mock("./storage",()=>({mutateOwner:async(_owner:string,change:(data:OwnerData)=>unknown)=>{const data=structuredClone(mocks.data!);const value=change(data);mocks.data=OwnerData.parse(data);return structuredClone(value);},ownersDueForCleanup:async()=>[],deferCleanup:async()=>{}}));
vi.mock("./github",()=>({collectGitHubEvidence:mocks.github}));
vi.mock("./openalex",()=>({collectResearchPapers:mocks.research}));
vi.mock("./public-profile",()=>({collectPublicProfile:mocks.page}));
vi.mock("./synthesis",()=>({synthesize:mocks.synthesis}));
import { createJob, getJob, stageCvText, recordDiscovery, reserveDiscovery, saveIdentity, cancelJob, retryJob } from "./state";
import { runEnrichment } from "./runner";
const owner="google:101";
const doc=(source:"github"|"research"|"public_profile")=>({id:`${owner}:${source==="github"?"repo":source==="research"?"paper":"profile_page"}:one`,personId:owner,sourceId:`${owner}:${source}`,source,kind:source==="github"?"repo" as const:source==="research"?"paper" as const:"profile_page" as const,title:source==="public_profile"?"Profile text":"Professional work",excerpt:"Compiler research",...(source!=="public_profile"?{url:"https://example.org"}:{}),retrievedAt:new Date().toISOString()});
const input=()=>({...enrichmentStart(),github:{import:false,bio:false,repos:false,orgs:false},research:null,publicProfile:{kind:"text" as const,text:"Compiler research"}});
beforeEach(()=>{mocks.data=emptyOwnerData();mocks.github.mockReset().mockResolvedValue({evidence:[doc("github")],github:{bio:false,repos:1,orgs:0}});mocks.research.mockReset().mockResolvedValue([doc("research")]);mocks.page.mockReset().mockResolvedValue(doc("public_profile"));mocks.synthesis.mockReset().mockImplementation(async(_o,_j,_t,_g,docs)=>({bio:"Builds compilers.",bioEvidenceIds:[docs[0].id],expertise:[]}));});
it("collects every selected source, passes only professional excerpts to one synthesis call, and leaves a private draft",async()=>{
  const body=input();const cv=await stageCvText(owner,{consent:true,text:"Ada\nEmail ada@example.org\nSkills\nRust and compilers"});
  const lookup={source:"research" as const,name:body.identity.name,workplaceName:body.identity.workplaceName,rorId:body.identity.rorId,orcid:body.identity.orcid};
  // As the discovery API does: confirmed identity first, then the reservation's generation binds the result.
  await saveIdentity(owner,body.identity);const generation=await reserveDiscovery(owner,lookup);
  await recordDiscovery(owner,lookup,{discoveryId:"lookup",source:"research",status:"ok",expiresAt:new Date(Date.now()+60_000).toISOString(),candidates:[{id:"A1",name:"Ada",url:"https://openalex.org/A1",orcid:null,affiliations:[],worksCount:1,samplePapers:[]}]},generation);
  const job=await createJob(owner,{...body,github:{import:true,bio:false,repos:true,orgs:false},research:{discoveryId:"lookup",candidateId:"A1"},cv:{uploadId:cv.uploadId}},"ada",7);
  await runEnrichment(owner,job.jobId,{github:{accountId:"101",accessToken:"private-token"},openAlexApiKey:"private-key"});
  const result=await getJob(owner,job.jobId);expect(result).toMatchObject({state:"ready",draft:{baseTextVersion:7}});
  expect(result.draft?.evidence).toHaveLength(4);expect(mocks.synthesis).toHaveBeenCalledOnce();
  expect(JSON.stringify(mocks.synthesis.mock.calls)).not.toMatch(/ada@example.org|private-token|private-key/);
  expect(JSON.stringify(mocks.data)).not.toMatch(/private-token|private-key/);
  expect(mocks.research).toHaveBeenCalledWith(owner,"A1","private-key");
});
it("retains successful sources when an optional source fails",async()=>{
  const job=await createJob(owner,{...input(),github:{import:true,bio:false,repos:true,orgs:false}},"ada");
  mocks.github.mockRejectedValue(new StateError("github_reconnect",409));
  await runEnrichment(owner,job.jobId,{});
  expect(await getJob(owner,job.jobId)).toMatchObject({state:"partial",sources:expect.arrayContaining([expect.objectContaining({source:"github",status:"failed",reason:"github_reconnect"})])});
});
it("never revives a job cancelled during a provider call",async()=>{
  const job=await createJob(owner,input(),null);
  mocks.page.mockImplementation(async()=>{await cancelJob(owner,job.jobId);return doc("public_profile");});
  await runEnrichment(owner,job.jobId,{});
  expect(await getJob(owner,job.jobId)).toMatchObject({state:"cancelled",draft:null});expect(mocks.synthesis).not.toHaveBeenCalled();
});
it("reports all-source failure honestly without calling AI",async()=>{
  const job=await createJob(owner,input(),null);mocks.page.mockRejectedValue(new Error("private provider response"));
  await runEnrichment(owner,job.jobId,{});
  expect(await getJob(owner,job.jobId)).toMatchObject({state:"failed",draft:null});expect(mocks.synthesis).not.toHaveBeenCalled();
});
it("leaves a retryable failed job when synthesis fails",async()=>{
  const job=await createJob(owner,input(),null);mocks.synthesis.mockRejectedValue(new Error("private response"));await runEnrichment(owner,job.jobId,{});
  expect(await getJob(owner,job.jobId)).toMatchObject({state:"failed",draft:null});
});
it("resumes failed sources without reimporting successful evidence and advances the draft version",async()=>{
  const job=await createJob(owner,{...input(),github:{import:true,bio:false,repos:true,orgs:false}},"ada",7);
  mocks.github.mockRejectedValueOnce(new StateError("provider_down",503));
  await runEnrichment(owner,job.jobId,{}); await retryJob(owner,job.jobId,8);
  await runEnrichment(owner,job.jobId,{github:{accountId:"101",accessToken:"private"}});
  expect(mocks.page).toHaveBeenCalledOnce(); expect(mocks.github).toHaveBeenCalledTimes(2);
  expect(await getJob(owner,job.jobId)).toMatchObject({state:"ready",draft:{draftVersion:2,baseTextVersion:8}});
});
it("does not restart a completed or unselected/manual job",async()=>{
  const body={...input(),publicProfile:null}; const job=await createJob(owner,body,null);
  await runEnrichment(owner,job.jobId,{});
  expect(await getJob(owner,job.jobId)).toMatchObject({state:"manual",draft:null});
  expect(mocks.page).not.toHaveBeenCalled(); expect(mocks.github).not.toHaveBeenCalled();expect(mocks.synthesis).not.toHaveBeenCalled();
});
it("supports canned AI without calling the model service",async()=>{
  const job=await createJob(owner,input(),null);await runEnrichment(owner,job.jobId,{fakeAi:true});
  expect(await getJob(owner,job.jobId)).toMatchObject({state:"ready",draft:{bioEvidenceIds:[doc("public_profile").id]}});
  expect(mocks.synthesis).not.toHaveBeenCalled();
});
it("treats evidence belonging to a different owner as a source failure",async()=>{
  const job=await createJob(owner,input(),null); mocks.page.mockResolvedValue({...doc("public_profile"),personId:"other"});
  await runEnrichment(owner,job.jobId,{});
  expect(await getJob(owner,job.jobId)).toMatchObject({state:"failed",draft:null});expect(mocks.synthesis).not.toHaveBeenCalled();
});
it("does not synthesize after its collection lease expires",async()=>{
  vi.useFakeTimers();
  try {
    const job=await createJob(owner,input(),null);
    mocks.page.mockImplementation(async()=>{vi.advanceTimersByTime(91_000);return doc("public_profile");});
    await runEnrichment(owner,job.jobId,{});
    expect(await getJob(owner,job.jobId)).toMatchObject({state:"stalled",draft:null});expect(mocks.synthesis).not.toHaveBeenCalled();
  } finally {vi.useRealTimers();}
});

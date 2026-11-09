import { beforeEach, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({create:vi.fn(),read:vi.fn(),write:vi.fn(),lease:vi.fn()}));
vi.mock("openai",()=>({default:class { responses={create:mocks.create}; }}));
vi.mock("./synthesis-cache",()=>({readSynthesisCache:mocks.read,writeSynthesisCache:mocks.write}));
vi.mock("./state",async original=>({...await original<typeof import("./state")>(),ensureLease:mocks.lease}));
import { synthesize } from "./synthesis";
const doc={id:"owner:paper:one",personId:"owner",sourceId:"owner:research",source:"research" as const,kind:"paper" as const,title:"Compilers",excerpt:"Builds compilers",url:"https://example.org",retrievedAt:new Date().toISOString()};
const identity={name:"Ada",country:"GB",workplaceName:"Private University",rorId:null,orcid:null};
const proposal={bio:"Builds compilers.",bioEvidenceIds:[doc.id],expertise:[{label:"Compilers",evidenceIds:[doc.id]}]};
const run=(generation=2)=>synthesize("owner","job","token",generation,[doc],identity);
beforeEach(()=>{mocks.lease.mockReset().mockResolvedValue(undefined);mocks.create.mockReset().mockResolvedValue({status:"completed",output_text:JSON.stringify(proposal),usage:{input_tokens:40,output_tokens:30}});mocks.read.mockReset().mockResolvedValue(undefined);mocks.write.mockReset().mockResolvedValue(undefined);});
it("uses one structured call for the evidence batch, with no tools, stored response, identity or URLs",async()=>{
  expect(await run()).toEqual(proposal);
  expect(mocks.create).toHaveBeenCalledOnce();
  const [body,options]=mocks.create.mock.calls[0];
  expect(body).toMatchObject({model:"gpt-5.4-mini",store:false,text:{format:{strict:true,type:"json_schema"}}});
  expect(body).not.toHaveProperty("tools"); expect(options).toMatchObject({timeout:20_000,maxRetries:0});
  expect(body.input).not.toMatch(/Ada|Private University|https:|retrievedAt/);
  expect(mocks.write).toHaveBeenCalledOnce();
});
it("uses a validated cache hit without calling the model",async()=>{mocks.read.mockResolvedValue(proposal);expect(await run()).toEqual(proposal);expect(mocks.create).not.toHaveBeenCalled();});
it("changes cache identity when consent generation changes",async()=>{await run(2);await run(3);expect(mocks.read.mock.calls[0][3]).not.toBe(mocks.read.mock.calls[1][3]);});
it.each([
  {...proposal,bioEvidenceIds:["other:paper:one"]},
  {...proposal,bio:"Works at Private University."},
  {...proposal,bio:"Lives in United Kingdom."},
  {...proposal,bio:"Email ada@example.org"},
  {...proposal,expertise:[{label:"Unsupported",evidenceIds:[]}]},
  {...proposal,bio:"a".repeat(601)},
])("rejects unsupported, private or oversized output without caching it",async invalid=>{
  mocks.create.mockResolvedValue({status:"completed",output_text:JSON.stringify(invalid)});
  await expect(run()).rejects.toMatchObject({code:"provider_down",status:503}); expect(mocks.write).not.toHaveBeenCalled();
});
it("does not use invalid cached references",async()=>{mocks.read.mockResolvedValue({...proposal,bioEvidenceIds:["foreign"]});expect(await run()).toEqual(proposal);expect(mocks.create).toHaveBeenCalledOnce();});
it.each(["incomplete","exception"])("sanitizes %s failures",async scenario=>{
  if(scenario==="incomplete")mocks.create.mockResolvedValue({status:"incomplete",output_text:JSON.stringify(proposal)});
  else mocks.create.mockRejectedValue(new Error("private-cv and secret-key"));
  const error=await run().catch(e=>e);expect(error).toMatchObject({code:"provider_down",status:503});expect(String(error)).not.toMatch(/private-cv|secret-key/);expect(error).not.toHaveProperty("cause");
});
it("does not call AI for empty evidence",async()=>{expect(await synthesize("owner","job","token",2,[],identity)).toEqual({bio:"",bioEvidenceIds:[],expertise:[]});expect(mocks.create).not.toHaveBeenCalled();});
it("does not start a model call after cancellation or expiry invalidates its lease",async()=>{
  mocks.lease.mockRejectedValue(new Error("revoked"));
  await expect(run()).rejects.toMatchObject({code:"provider_down",status:503});expect(mocks.create).not.toHaveBeenCalled();expect(mocks.write).not.toHaveBeenCalled();
});
it("gives the model short refs, maps them back, and drops refs the text repeats (a Google owner's ID never reaches it)",async()=>{
  // Live gpt-5.4-mini answers (2026-11-09) miscopied long IDs and repeated them in the bio, where a Google
  // sign-in's 21-digit subject read as a phone number: every draft was rejected.
  const owner="google:108765432109876543210";
  const docs=Array.from({length:10},(_,i)=>({...doc,id:`${owner}:cv:excerpt-${i+1}`,personId:owner,sourceId:`${owner}:cv`,source:"cv" as const,kind:"cv" as const,url:undefined,excerpt:`Builds compilers ${i+1}`}));
  mocks.create.mockResolvedValue({status:"completed",output_text:JSON.stringify({
    bio:"Builds compilers and CI pipelines [ev1]. Also works on build tools. [ev1][ev10] (ev2, ev10)",bioEvidenceIds:["ev1","ev10"],
    expertise:[{label:"Compilers [ev2]",evidenceIds:["ev2"]},{label:"e2e testing",evidenceIds:["ev10"]}]})});
  expect(await synthesize(owner,"job","token",2,docs,identity)).toEqual({bio:"Builds compilers and CI pipelines. Also works on build tools.",
    bioEvidenceIds:[docs[0].id,docs[9].id],expertise:[{label:"Compilers",evidenceIds:[docs[1].id]},{label:"e2e testing",evidenceIds:[docs[9].id]}]});
  const body=mocks.create.mock.calls[0][0];
  expect(body.input).not.toContain(owner); expect(JSON.parse(body.input).map((e:{id:string})=>e.id)).toEqual(docs.map((_,i)=>`ev${i+1}`));
});
it("rejects a ref the batch doesn't have",async()=>{
  mocks.create.mockResolvedValue({status:"completed",output_text:JSON.stringify({...proposal,bioEvidenceIds:["ev2"]})});
  await expect(run()).rejects.toMatchObject({code:"provider_down",status:503});
});
it.each([
  {label:"Mobile robotics"},{label:"Contact tracing systems"},{label:"Address space layout"},{label:"Religion and technology"},
  {label:"References and citation tooling"},{bio:"Builds 3 robots that drive through warehouses, tested from 2019 to 2024."},
  {bio:"Mobile-first web development with React and Next.js."},
])("accepts professional wording the CV line filter would drop: %o",async change=>{
  const ok={...proposal,...(change.bio?{bio:change.bio}:{}),...(change.label?{expertise:[{label:change.label,evidenceIds:[doc.id]}]}:{})};
  mocks.create.mockResolvedValue({status:"completed",output_text:JSON.stringify(ok)});
  expect(await run()).toEqual(ok);
});
it.each([
  "Call +1 930 904 3423 to talk.","Reach me at ada@example.org.","Based at 12 Main Street.","Date of birth 1 Jan 1990.","Passport holder.",
])("still rejects contact or personal details: %s",async bio=>{
  mocks.create.mockResolvedValue({status:"completed",output_text:JSON.stringify({...proposal,bio})});
  await expect(run()).rejects.toMatchObject({code:"provider_down",status:503});
});

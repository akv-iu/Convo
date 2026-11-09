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

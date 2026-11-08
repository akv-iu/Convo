import { beforeEach, expect, it, vi } from "vitest";
import { enrichmentIdentity, enrichmentStart } from "@/contracts/fixtures/enrichment";
const mocks = vi.hoisted(() => ({ currentProvider: vi.fn(), account: vi.fn(), staged: vi.fn(), save: vi.fn(), create: vi.fn(), user: vi.fn(), job: vi.fn(), retry: vi.fn() }));
vi.mock("../connection",()=>({ accountState:mocks.currentProvider }));
vi.mock("../identities",()=>({ readAccountState:mocks.account }));
vi.mock("../service",()=>({ readUser:mocks.user }));
vi.mock("./state",()=>({ readPrivateState:mocks.staged, saveIdentity:mocks.save, createJob:mocks.create, getJob:mocks.job, retryJob:mocks.retry }));
import { enrichmentState, saveEnrichmentIdentity, startEnrichment, getEnrichment, retryEnrichment } from "./service";
it("uses the current text revision when polling or deliberately retrying a draft",async()=>{
  mocks.user.mockResolvedValue({textVersion:7});
  await getEnrichment("owner","job"); await retryEnrichment("owner","job");
  expect(mocks.job).toHaveBeenCalledWith("owner","job",7); expect(mocks.retry).toHaveBeenCalledWith("owner","job",7);
});
beforeEach(()=>{vi.clearAllMocks();mocks.currentProvider.mockResolvedValue("google");mocks.account.mockResolvedValue({signIn:{provider:"google"},github:{connected:false,login:null},onboarded:false,identity:null,job:null,pendingCv:null});
  mocks.staged.mockResolvedValue({identity:enrichmentIdentity,job:{jobId:"saved-job",state:"manual"},pendingCv:null});mocks.save.mockResolvedValue({identity:enrichmentIdentity,job:null,pendingCv:null});mocks.create.mockResolvedValue({state:"manual"});});
it("composes authenticated owner state with only safe staging metadata",async()=>{
  expect(await enrichmentState("owner")).toMatchObject({signIn:{provider:"google"},identity:enrichmentIdentity,job:{jobId:"saved-job"}});
  expect(mocks.staged).toHaveBeenCalledWith("owner");expect(mocks.account).toHaveBeenCalledWith("owner","google");
});
it("stages answers without publishing or changing the public profile",async()=>{
  expect(await saveEnrichmentIdentity("owner",enrichmentIdentity)).toMatchObject({identity:enrichmentIdentity,onboarded:false});
  expect(mocks.save).toHaveBeenCalledWith("owner",enrichmentIdentity);
});
it("allows a real all-off/skip manual continuation",async()=>{
  const body=enrichmentStart();body.github.import=false;body.research={skip:true};body.publicProfile={skip:true};
  expect(await startEnrichment("owner",body)).toMatchObject({state:"manual"});expect(mocks.create).toHaveBeenCalledWith("owner",body,null);
});
it.each(["github","research","publicProfile","cv"] as const)("does not enqueue unimplemented collection for %s",async source=>{
  const body=enrichmentStart();body.github.import=false;
  if(source==="github")body.github.import=true;
  if(source==="research")body.research={discoveryId:"preview",candidateId:"author"};
  if(source==="publicProfile")body.publicProfile={kind:"text",text:"private"};
  if(source==="cv")body.cv={uploadId:crypto.randomUUID()};
  await expect(startEnrichment("owner",body)).rejects.toMatchObject({status:501,code:"not_ready"});expect(mocks.create).not.toHaveBeenCalled();
});

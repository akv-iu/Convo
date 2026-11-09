import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { people } from "@/contracts/fixtures";
const mocks=vi.hoisted(()=>({query:vi.fn(),sync:vi.fn()}));
vi.mock("@neondatabase/serverless",async original=>({...await original<typeof import("@neondatabase/serverless")>(),neon:()=>({query:mocks.query})}));
vi.mock("./service",()=>({syncProfile:mocks.sync}));
import { providerSubject, readAccountState, refreshGitHubHandle, resolveIdentity } from "./identities";
const person=people[0];
function saved(filters: typeof person.filters|null=person.filters) {
  return {rows:[[person.id,"renamed",person.name,person.bio,JSON.stringify(person.languages),JSON.stringify(person.organisations),
    filters===null?null:JSON.stringify(filters),JSON.stringify(person.freeTimes),"2026-11-05T00:00:00Z",7,null,"sunflower",
    JSON.stringify({country:true,workplace:true,hiring:true}),"[]",false]]};
}
beforeEach(()=>{vi.stubEnv("DATABASE_URL","postgresql://unused:unused@example.invalid/unused");mocks.query.mockReset();mocks.sync.mockReset().mockResolvedValue(person);});
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();});

it.each([["github","login-name"],["github","0"],["google","bad/subject"],["google",""]] as const)("validates stable provider subjects: %s %s",(provider,subject)=>{
  expect(()=>providerSubject(provider,subject)).toThrow("Invalid provider identity");
});
it.each(["google","github"] as const)("creates an identity without importing optional data or trusting mutable identifiers (%s)",async provider=>{
  mocks.query.mockResolvedValueOnce({rows:[{user_id:`${provider}:101`,created_id:`${provider}:101`}]});
  expect(await resolveIdentity(provider,"101",provider==="github"?"renamed":null)).toBe(`${provider}:101`);
  const [statement,params]=mocks.query.mock.calls[0];
  expect(statement).toContain("on conflict (provider, provider_account_id) do update set user_id = auth_identities.user_id");
  expect(statement).not.toContain("github_evidence");
  expect(params).toContain(`${provider}:101`);expect(params).not.toContain("Provider Name");
});
it("signs a renamed GitHub into the existing Google account and leaves existing user rows untouched",async()=>{
  mocks.query.mockResolvedValueOnce({rows:[{user_id:"google:900",created_id:null}]});
  expect(await resolveIdentity("github","101","renamed")).toBe("google:900");
  expect(mocks.query).toHaveBeenCalledOnce();
});
it("cleans up only its own provisional row when a concurrent explicit link wins",async()=>{
  mocks.query.mockResolvedValueOnce({rows:[{user_id:"google:900",created_id:"github:101"}]}).mockResolvedValueOnce({rows:[]});
  expect(await resolveIdentity("github","101","renamed")).toBe("google:900");
  expect(mocks.query.mock.calls[1][0]).toContain('delete from "users"');
  expect(mocks.query.mock.calls[1][0]).toContain("not exists");
});
it("rejects unconfirmed database writes",async()=>{
  mocks.query.mockResolvedValueOnce({rows:[]});
  await expect(resolveIdentity("google","101",null)).rejects.toThrow("did not confirm");
});
it("retains saved profile fields and evidence while refreshing only the connected handle/revision",async()=>{
  mocks.query.mockResolvedValueOnce(saved());
  await refreshGitHubHandle(person.id,"renamed");
  const [statement]=mocks.query.mock.calls[0];
  expect(statement.split(" where ")[0]).not.toMatch(/set.*(bio|name|github_evidence|filters|free_times)/);
  expect(mocks.sync).toHaveBeenCalledWith(expect.objectContaining({githubLogin:"renamed",bio:person.bio,revision:7}));
});
it("keeps search failure from failing authentication and never logs the provider/database error",async()=>{
  mocks.query.mockResolvedValueOnce(saved());mocks.sync.mockRejectedValueOnce(new Error("secret-token"));
  const warning=vi.spyOn(console,"warn").mockImplementation(()=>undefined);
  await expect(refreshGitHubHandle(person.id,"renamed")).resolves.toBeUndefined();
  expect(warning).toHaveBeenCalledExactlyOnceWith("[auth] Profile saved; search synchronization pending.");
});
it("does not index unfinished accounts",async()=>{
  mocks.query.mockResolvedValueOnce(saved(null));
  await refreshGitHubHandle(person.id,"renamed");expect(mocks.sync).not.toHaveBeenCalled();
});
it("reports a Google-only owner without inventing a handle",async()=>{
  mocks.query.mockResolvedValueOnce({rows:[[null,null]]}).mockResolvedValueOnce({rows:[]});
  expect(await readAccountState("google:900","google")).toEqual({signIn:{provider:"google"},github:{connected:false,login:null},onboarded:false,identity:null,job:null,pendingCv:null});
});
it("reports a connected, onboarded owner",async()=>{
  mocks.query.mockResolvedValueOnce({rows:[["renamed",JSON.stringify(person.filters)]]}).mockResolvedValueOnce({rows:[["101"]]});
  expect(await readAccountState("google:900","google")).toMatchObject({github:{connected:true,login:"renamed"},onboarded:true});
});
it("does not return state for a deleted account",async()=>{
  mocks.query.mockResolvedValueOnce({rows:[]});
  await expect(readAccountState("missing","google")).rejects.toMatchObject({status:404});
});
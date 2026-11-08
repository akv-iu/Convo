import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({authorize:vi.fn(),clear:vi.fn(),signIn:vi.fn(),get:vi.fn(),runtime:{fakeApi:false,profileEnrichmentEnabled:true}}));
vi.mock("next/server",()=>({connection:async()=>undefined}));
vi.mock("next/headers",()=>({cookies:async()=>({get:mocks.get})}));
vi.mock("@/server/auth",()=>({signIn:mocks.signIn}));
vi.mock("@/server/config",()=>({config:mocks.runtime}));
vi.mock("./connection",()=>({authorizeGitHubConnection:mocks.authorize,clearConnection:mocks.clear,ENRICHMENT_RETURN:"/signin",LINK_COOKIE:"convo_github_link"}));
import { GET as connect } from "@/app/api/auth/connect/github/route";
import { GET as errorPage } from "@/app/api/auth/enrichment-error/route";
beforeEach(()=>{mocks.runtime.fakeApi=false;mocks.runtime.profileEnrichmentEnabled=true;vi.clearAllMocks();mocks.authorize.mockReset();mocks.clear.mockResolvedValue(undefined);});
afterEach(()=>vi.restoreAllMocks());
it("starts GitHub linking only through its protected server-side authorization flow",async()=>{
  mocks.signIn.mockResolvedValue("https://github.com/login/oauth/authorize?recorded");
  mocks.authorize.mockImplementation(async(start:()=>Promise<string>)=>start());
  const response=await connect(new Request("https://app.invalid/api/auth/connect/github"));
  expect(response.status).toBe(303);expect(response.headers.get("location")).toBe("https://github.com/login/oauth/authorize?recorded");
  expect(mocks.signIn).toHaveBeenCalledWith("github",{redirect:false,redirectTo:"/signin"});
});
it("returns a failed attempt to page two without leaking a raw error",async()=>{
  mocks.authorize.mockRejectedValue(new Error("secret-error"));
  const response=await connect(new Request("https://app.invalid/api/auth/connect/github"));
  expect(response.headers.get("location")).toBe("https://app.invalid/signin?enrichmentError=github_reconnect");
  expect(mocks.clear).toHaveBeenCalled();
});
it.each([{fakeApi:true,profileEnrichmentEnabled:true},{fakeApi:false,profileEnrichmentEnabled:false}])("keeps real linking unavailable outside the enabled real backend",async settings=>{
  Object.assign(mocks.runtime,settings);
  expect((await connect(new Request("https://app.invalid/api/auth/connect/github"))).status).toBe(404);
  expect(mocks.authorize).not.toHaveBeenCalled();
});
it.each([false,true])("returns cancellation without changing the session (linking=%s)",async linking=>{
  mocks.get.mockReturnValue(linking?{value:"attempt"}:undefined);
  const response=await errorPage(new Request("https://app.invalid/api/auth/enrichment-error?error=AccessDenied&callbackUrl=https://evil.invalid"));
  expect(response.headers.get("location")).toBe(`https://app.invalid/signin?enrichmentError=${linking?"github_connect_cancelled":"sign_in_cancelled"}`);
});
it("keeps other OAuth errors distinct from cancellation",async()=>{
  const response=await errorPage(new Request("https://app.invalid/api/auth/enrichment-error?error=RawSecretError"));
  expect(response.headers.get("location")).toBe("https://app.invalid/signin?enrichmentError=provider_down");
});
it("keeps the error return route disabled with the feature",async()=>{
  mocks.runtime.profileEnrichmentEnabled=false;
  expect((await errorPage(new Request("https://app.invalid/api/auth/enrichment-error"))).status).toBe(404);
});
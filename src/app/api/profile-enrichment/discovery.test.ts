import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEMO_USER_A } from "@/contracts/fixtures";
import { enrichmentIdentity, enrichmentStart } from "@/contracts/fixtures/enrichment";
import { EnrichmentDiscovery } from "@/contracts/enrichment";
import type { RouteBody } from "@/contracts/routes";
import type { OwnerData } from "@/server/profile/enrichment/model";

const mocks = vi.hoisted(() => ({
  runtime: { fakeApi: false, fakeSearch: true, fakeAi: true, profileEnrichmentEnabled: true,
    openAlexApiKey: "recorded-openalex-key", braveSearchApiKey: "recorded-brave-key" },
  identity: { userId: "google:101" as string | null },
  query: vi.fn(), rows: new Map<string, { version: number; data: OwnerData }>(),
}));
vi.mock("@/server/config", () => ({ config: mocks.runtime }));
vi.mock("@/server/auth", () => ({ getUserId: async () => mocks.identity.userId }));
vi.mock("next/server", async original => ({ ...await original<typeof import("next/server")>(), connection: async () => undefined }));
// Only the database driver is replaced: route, dispatch, discovery, state and persistence stay real.
vi.mock("@neondatabase/serverless", async original => ({
  ...await original<typeof import("@neondatabase/serverless")>(), neon: () => ({ query: mocks.query }),
}));

import { POST } from "./discover/route";
import { createJob, saveIdentity } from "@/server/profile/enrichment/state";
import { store } from "@/contracts/fake/store";

const owner = "google:101";
type Source = RouteBody<"discoverEnrichment">["source"];
const lookup = (source: Source): RouteBody<"discoverEnrichment"> => ({
  source, name: enrichmentIdentity.name, workplaceName: enrichmentIdentity.workplaceName, rorId: null, orcid: null,
});
const request = (body: unknown) => new Request("https://lanyard.example/api/profile-enrichment/discover", {
  method: "POST", headers: { "Content-Type": "application/json", Origin: "https://lanyard.example" }, body: JSON.stringify(body),
});
const discover = (source: Source) => POST(request(lookup(source)), { params: Promise.resolve({}) });
const json = (body: unknown, status = 200, headers = {}) => Response.json(body, { status, headers });
const author = { id: "https://openalex.org/A101", display_name: "Demo <b>Researcher</b>", orcid: null, works_count: 2, affiliations: [] };
const recorded = (url: URL) => {
  if (url.hostname === "api.search.brave.com") return json({ web: { results: Array.from({ length: 6 }, (_, n) => ({
    title: `Demo <b>profile</b> ${n}`, description: "Research &amp; <em>systems</em>", url: `https://people.example/profile/${n}`,
  })) } });
  if (url.hostname === "api.openalex.org" && url.pathname === "/authors") return json({ results: [author] });
  if (url.hostname === "api.openalex.org" && url.pathname === "/works") return json({ results: [] });
  throw new Error("Unexpected provider request in recorded test");
};
let reply: (url: URL, init?: RequestInit) => Response | Promise<Response>;
const fetcher = vi.fn<typeof fetch>(async (input, init) => reply(new URL(String(input)), init));
const staged = () => mocks.rows.get(owner)!.data;

beforeEach(async () => {
  mocks.rows.clear(); store.reset(); mocks.identity.userId = owner;
  Object.assign(mocks.runtime, { fakeApi: false, profileEnrichmentEnabled: true,
    openAlexApiKey: "recorded-openalex-key", braveSearchApiKey: "recorded-brave-key" });
  vi.stubEnv("DATABASE_URL", "postgresql://unused:unused@example.invalid/unused");
  vi.stubGlobal("fetch", fetcher); fetcher.mockClear(); reply = recorded;
  // Recorded Neon array rows, with the real storage's version-guarded writes.
  mocks.query.mockReset().mockImplementation(async (sql: string, params: unknown[]) => {
    if (sql.startsWith("select") && sql.includes('from "profile_enrichment_states"')) {
      const row = mocks.rows.get(String(params[0]));
      return { rows: row ? [[String(params[0]), row.version, JSON.stringify(row.data), null]] : [] };
    }
    if (sql.startsWith('insert into "profile_enrichment_states"')) {
      const id = String(params[0]);
      if (mocks.rows.has(id)) return { rows: [] };
      mocks.rows.set(id, { version: Number(params[1]), data: JSON.parse(String(params[2])) });
      return { rows: [[id]] };
    }
    if (sql.startsWith('update "profile_enrichment_states"')) {
      const id = String(params.at(-2));
      if (mocks.rows.get(id)?.version !== params.at(-1)) return { rows: [] };
      mocks.rows.set(id, { version: Number(params[0]), data: JSON.parse(String(params[1])) });
      return { rows: [[id]] };
    }
    throw new Error("Unexpected SQL in recorded discovery test");
  });
  await saveIdentity(owner, enrichmentIdentity);
  mocks.query.mockClear();
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it.each(["research", "public_profile"] as const)("reaches real %s discovery with a durable reservation and the source's own key", async source => {
  reply = (url, init) => {
    expect(staged().limits.discovery?.count).toBe(1); // already committed before the first fetch
    const headers = new Headers(init?.headers);
    if (source === "research") {
      expect(url.hostname).toBe("api.openalex.org");
      expect(headers.get("authorization")).toBe("Bearer recorded-openalex-key");
    } else {
      expect(url.hostname).toBe("api.search.brave.com");
      expect(headers.get("x-subscription-token")).toBe("recorded-brave-key");
    }
    expect(url.href).not.toContain("recorded-");
    return recorded(url);
  };
  const response = await discover(source);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const found = EnrichmentDiscovery.parse(await response.json());
  expect(found).toMatchObject({ source, status: "ok" });
  expect(found.candidates).toHaveLength(source === "research" ? 1 : 4);
  expect(JSON.stringify(found)).not.toMatch(/<b>|<em>|recorded-/);
  expect(found.candidates.every(candidate => candidate.url.startsWith("https://"))).toBe(true);
  expect(staged().discoveries.map(d => d.value)).toEqual([found]);
  expect(Date.parse(found.expiresAt) - Date.now()).toBeGreaterThan(3_590_000);
  expect(Date.parse(found.expiresAt) - Date.now()).toBeLessThanOrEqual(3_600_000);
});

it.each(["research", "public_profile"] as const)("missing %s credentials still count the attempt and leave the other source usable", async source => {
  mocks.runtime[source === "research" ? "openAlexApiKey" : "braveSearchApiKey"] = "";
  const response = await discover(source);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ source, status: "unavailable", reason: "provider_down", candidates: [] });
  expect(fetcher).not.toHaveBeenCalled();
  expect(staged().limits.discovery?.count).toBe(1);
  const other = source === "research" ? "public_profile" : "research";
  expect(await (await discover(other)).json()).toMatchObject({ source: other, status: "ok" });
  expect(staged().limits.discovery?.count).toBe(2);
});

it.each(["research", "public_profile"] as const)("returns no_matches for an empty %s reply without storing a list", async source => {
  reply = () => json(source === "research" ? { results: [] } : { web: { results: [] } });
  const response = await discover(source);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ status: "no_matches", candidates: [] });
  expect(staged().discoveries).toEqual([]);
});

it.each([
  ["rate limit", () => json({ error: "private upstream recorded-brave-key" }, 429, { "Retry-After": "120" }), "rate_limited"],
  ["timeout", () => Promise.reject(new DOMException("private upstream recorded-brave-key", "TimeoutError")), "timeout"],
  ["outage", () => json({ error: "private upstream recorded-brave-key" }, 500), "provider_down"],
  ["malformed reply", () => json({ web: { results: "private upstream recorded-brave-key" } }), "provider_down"],
] as const)("sanitizes a provider %s through the real API", async (_, failure, reason) => {
  const logs = (["log", "info", "warn", "error", "debug"] as const).map(level => vi.spyOn(console, level));
  reply = failure;
  const response = await discover("public_profile");
  expect(response.status).toBe(200);
  const found = EnrichmentDiscovery.parse(await response.json());
  expect(found).toMatchObject({ status: "unavailable", reason, candidates: [] });
  if (reason === "rate_limited") expect(found.retryAfterSeconds).toBe(120);
  expect(JSON.stringify(found)).not.toMatch(/private upstream|recorded-/);
  for (const log of logs) expect(log).not.toHaveBeenCalled();
});

it.each(["identity", "consent"] as const)("rejects a late result after the owner's %s changes", async change => {
  let changed = false;
  reply = async url => {
    if (!changed) {
      changed = true;
      if (change === "identity") await saveIdentity(owner, { ...enrichmentIdentity, name: "Changed identity" });
      else await createJob(owner, { ...enrichmentStart(), github: { import: false, bio: false, repos: false, orgs: false } }, null);
    }
    return recorded(url);
  };
  const response = await discover("public_profile");
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ code: "selection_stale" });
  expect(staged().discoveries).toEqual([]);
});

it("binds the lookup to the authenticated owner and rejects exhausted attempts before fetching", async () => {
  mocks.identity.userId = "google:other";
  const foreign = await discover("research");
  expect(foreign.status).toBe(409);
  expect(await foreign.json()).toMatchObject({ code: "selection_stale" });
  expect(mocks.rows.has("google:other")).toBe(false);
  mocks.identity.userId = owner;
  staged().limits.discovery = { since: Date.now(), count: 12 };
  const limited = await discover("research");
  expect(limited.status).toBe(429);
  expect(await limited.json()).toMatchObject({ code: "rate_limited", retryAfterSeconds: expect.any(Number) });
  expect(fetcher).not.toHaveBeenCalled();
});

it.each(["disabled", "signed out", "foreign origin"] as const)("keeps the %s boundary ahead of parsing, storage and providers", async boundary => {
  const req = request(lookup("research"));
  if (boundary === "disabled") mocks.runtime.profileEnrichmentEnabled = false;
  if (boundary === "signed out") mocks.identity.userId = null;
  if (boundary === "foreign origin") req.headers.set("origin", "https://foreign.example");
  const response = await POST(req, { params: Promise.resolve({}) });
  expect(response.status).toBe(boundary === "disabled" ? 404 : boundary === "signed out" ? 401 : 403);
  expect(req.bodyUsed).toBe(false);
  expect(mocks.query).not.toHaveBeenCalled();
  expect(fetcher).not.toHaveBeenCalled();
});

it("keeps FAKE_API discovery on the existing fake without database or provider access", async () => {
  mocks.runtime.fakeApi = true; mocks.identity.userId = DEMO_USER_A;
  const response = await discover("research");
  expect(response.status).toBe(200);
  const found = EnrichmentDiscovery.parse(await response.json());
  expect(found.status).toBe("ok");
  expect(found.candidates).toHaveLength(4);
  expect(found.candidates[0]).toMatchObject({ name: `${enrichmentIdentity.name} (demo 1)` });
  expect(mocks.query).not.toHaveBeenCalled();
  expect(fetcher).not.toHaveBeenCalled();
});

it("does not fetch when durable reservation fails, and sanitizes the database error", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  mocks.query.mockRejectedValueOnce(new Error("private SQL recorded-openalex-key"));
  const response = await discover("research");
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ code: "provider_down" });
  expect(fetcher).not.toHaveBeenCalled();
  expect(JSON.stringify(warn.mock.calls)).not.toMatch(/private SQL|recorded-/);
});

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enrichmentIdentity } from "@/contracts/fixtures/enrichment";
import type { RouteBody } from "@/contracts/routes";
import { emptyOwnerData, OwnerData } from "./model";

// Durable owner storage, in memory: a mutation that throws saves nothing, as in Postgres.
const mocks = vi.hoisted(() => ({ data: new Map<string, OwnerData>() }));
vi.mock("./storage", () => ({
  mutateOwner: async <T>(owner: string, change: (data: OwnerData) => T): Promise<T> => {
    const data = structuredClone(mocks.data.get(owner) ?? emptyOwnerData());
    const result = change(data); mocks.data.set(owner, OwnerData.parse(data)); return structuredClone(result);
  },
  ownersDueForCleanup: vi.fn(), deferCleanup: vi.fn(),
}));
import { discoverEnrichment } from "./discovery";
import { createJob, DISCOVERY_TTL_MS, readPrivateState, recordDiscovery, reserveDiscovery, saveIdentity } from "./state";

const owner = "google:101";
const keys = { openAlexApiKey: "recorded-openalex-key", braveSearchApiKey: "recorded-brave-key" };
const lookup = (source: "research" | "public_profile"): RouteBody<"discoverEnrichment"> =>
  ({ source, name: enrichmentIdentity.name, workplaceName: enrichmentIdentity.workplaceName, rorId: null, orcid: null });
const manual = (): RouteBody<"startEnrichment"> => ({ identity: { ...enrichmentIdentity }, idempotencyKey: crypto.randomUUID(),
  github: { import: false, bio: false, repos: false, orgs: false }, research: null, publicProfile: null, cv: null });

// Recorded provider replies; nothing leaves the machine.
const brave = JSON.parse(readFileSync(new URL("./fixtures/public-profile/brave-search.json", import.meta.url), "utf8"));
const author = { id: "https://openalex.org/A101", display_name: "Demo Researcher", orcid: null, works_count: 3, affiliations: [] };
const work = { id: "https://openalex.org/W101", display_name: "Recorded paper", publication_year: 2025, doi: null,
  authorships: [{ author: { id: "https://openalex.org/A101" } }] };
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const recorded = (url: URL) => {
  if (url.hostname === "api.search.brave.com") return json(brave);
  return json({ results: [url.pathname === "/authors" ? author : work] });
};
let reply: (url: URL) => Response | Promise<Response>;
const fetcher = vi.fn<typeof fetch>(async input => reply(new URL(String(input))));
const stored = () => mocks.data.get(owner)?.discoveries ?? [];
const quiet = () => (["log", "info", "warn", "error", "debug"] as const).map(level => vi.spyOn(console, level));

beforeEach(async () => {
  mocks.data.clear(); fetcher.mockClear(); reply = recorded; vi.stubGlobal("fetch", fetcher);
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-07T12:00:00Z"));
  await saveIdentity(owner, enrichmentIdentity);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("returns at most four candidates per source that only their owner can start with", async () => {
  const pages = await discoverEnrichment(owner, lookup("public_profile"), keys);
  const research = await discoverEnrichment(owner, lookup("research"), keys);
  expect(pages).toMatchObject({ source: "public_profile", status: "ok" });
  expect(pages.candidates).toHaveLength(4);
  expect(research).toMatchObject({ source: "research", status: "ok", candidates: [{ id: "A101", url: "https://openalex.org/A101" }] });
  expect(Date.parse(pages.expiresAt)).toBe(Date.now() + DISCOVERY_TTL_MS);
  const body = { ...manual(), research: { discoveryId: research.discoveryId, candidateId: "A101" },
    publicProfile: { discoveryId: pages.discoveryId, candidateId: pages.candidates[0].id } };
  const job = await createJob(owner, body, null);
  expect(job.sources.map(s => s.selection?.url)).toEqual([undefined, "https://openalex.org/A101", pages.candidates[0].url, undefined]);
  // Another account with the same name can't use these lists, and has none of its own.
  await saveIdentity("google:202", enrichmentIdentity);
  await expect(createJob("google:202", { ...body, idempotencyKey: crypto.randomUUID() }, null)).rejects.toMatchObject({ code: "selection_stale" });
  expect(mocks.data.get("google:202")?.discoveries).toEqual([]);
});

it("counts each search durably before contacting a provider", async () => {
  const countAtContact: (number | undefined)[] = [];
  reply = url => { countAtContact.push(mocks.data.get(owner)?.limits.discovery?.count); return recorded(url); };
  await discoverEnrichment(owner, lookup("public_profile"), keys);
  await discoverEnrichment(owner, lookup("research"), keys);
  expect(countAtContact).toEqual([1, 2, 2]); // Brave once; OpenAlex authors then works
});

it("counts failed searches and refuses the thirteenth without contacting a provider", async () => {
  reply = () => json({ error: "upstream detail" }, 500);
  for (let n = 0; n < 12; n++) {
    expect(await discoverEnrichment(owner, lookup(n % 2 ? "research" : "public_profile"), keys)).toMatchObject({ status: "unavailable", reason: "provider_down" });
  }
  fetcher.mockClear();
  await expect(discoverEnrichment(owner, lookup("research"), keys)).rejects.toMatchObject({ status: 429, code: "rate_limited", retryAfterSeconds: 600 });
  expect(fetcher).not.toHaveBeenCalled();
  vi.setSystemTime(Date.now() + 600_001); reply = recorded;
  expect((await discoverEnrichment(owner, lookup("research"), keys)).status).toBe("ok");
});

it("searches only the owner's saved identity, without counting a refused search", async () => {
  await expect(discoverEnrichment(owner, { ...lookup("research"), name: "Someone Else" }, keys)).rejects.toMatchObject({ code: "selection_stale" });
  await expect(discoverEnrichment("google:303", lookup("research"), keys)).rejects.toMatchObject({ code: "selection_stale" });
  await expect(discoverEnrichment(owner, { ...lookup("research"), source: "github" } as never, keys)).rejects.toMatchObject({ status: 400, code: "invalid_input" });
  expect(fetcher).not.toHaveBeenCalled();
  expect(mocks.data.get(owner)?.limits.discovery).toBeUndefined();
});

it.each([
  ["the identity changes", () => saveIdentity(owner, { ...enrichmentIdentity, name: "Changed Name" })],
  ["the sources are confirmed", () => createJob(owner, manual(), null)],
])("refuses a result that finishes after %s", async (_, change) => {
  let changed = false;
  reply = async url => { if (!changed) { changed = true; await change(); } return recorded(url); };
  await expect(discoverEnrichment(owner, lookup("public_profile"), keys)).rejects.toMatchObject({ code: "selection_stale" });
  expect(stored()).toEqual([]);
});

it("keeps each source independent: one failing, the other usable, neither evicting the other", async () => {
  reply = url => url.hostname === "api.openalex.org" ? json({}, 503) : recorded(url);
  const [research, pages] = await Promise.all([discoverEnrichment(owner, lookup("research"), keys), discoverEnrichment(owner, lookup("public_profile"), keys)]);
  expect(research).toMatchObject({ status: "unavailable", reason: "provider_down", candidates: [] });
  expect(pages.status).toBe("ok");
  expect(stored().map(d => d.value.discoveryId)).toEqual([pages.discoveryId]);
  reply = recorded;
  for (let n = 0; n < 16; n++) {
    if (n === 10) vi.setSystemTime(Date.now() + 600_001); // next rate window, still within the lists' hour
    await discoverEnrichment(owner, lookup("research"), keys);
  }
  expect(stored()).toHaveLength(16);
  const job = await createJob(owner, { ...manual(), publicProfile: { discoveryId: pages.discoveryId, candidateId: pages.candidates[1].id } }, null);
  expect(job.sources[2].selection?.url).toBe(pages.candidates[1].url);
});

it("expires lists after an hour and keeps empty or failed results out of storage", async () => {
  const research = await discoverEnrichment(owner, lookup("research"), keys);
  reply = () => json({ web: { results: [] } });
  expect(await discoverEnrichment(owner, lookup("public_profile"), keys)).toMatchObject({ status: "no_matches", candidates: [] });
  expect((await discoverEnrichment(owner, lookup("public_profile"), keys)).reason).toBeUndefined();
  expect(stored().map(d => d.value.discoveryId)).toEqual([research.discoveryId]);
  vi.setSystemTime(Date.now() + DISCOVERY_TTL_MS);
  await expect(createJob(owner, { ...manual(), research: { discoveryId: research.discoveryId, candidateId: "A101" } }, null)).rejects.toMatchObject({ code: "selection_stale" });
  await readPrivateState(owner); // a later read clears the expired list from storage
  expect(stored()).toEqual([]);
  // A result can't be kept for longer than the hour.
  const generation = await reserveDiscovery(owner, lookup("research"));
  const tooLong = { ...research, expiresAt: new Date(Date.now() + DISCOVERY_TTL_MS + 1000).toISOString() };
  await expect(Promise.resolve().then(() => recordDiscovery(owner, lookup("research"), tooLong, generation))).rejects.toMatchObject({ code: "invalid_input" });
});

it.each([
  ["rate limited", () => json({ error: "upstream" }, 429, { "Retry-After": "120" }), { reason: "rate_limited", retryAfterSeconds: 120 }],
  ["timed out", () => Promise.reject(new DOMException("upstream", "TimeoutError")), { reason: "timeout" }],
  ["down", () => json({ error: `upstream ${keys.braveSearchApiKey} ${enrichmentIdentity.name}` }, 500), { reason: "provider_down" }],
  ["malformed", () => json({ web: { results: "upstream" } }), { reason: "provider_down" }],
] as const)("explains a provider that is %s without passing on its text", async (_, failure, expected) => {
  const logs = quiet();
  reply = failure;
  const found = await discoverEnrichment(owner, lookup("public_profile"), keys);
  expect(found).toMatchObject({ status: "unavailable", candidates: [], ...expected });
  if (!("retryAfterSeconds" in expected)) expect(found.retryAfterSeconds).toBeUndefined();
  expect(JSON.stringify(found)).not.toMatch(/upstream|recorded-|Demo Researcher/);
  for (const log of logs) expect(log).not.toHaveBeenCalled();
});

it("keeps credentials explicit and out of URLs, replies and errors", async () => {
  const logs = quiet();
  expect(await discoverEnrichment(owner, lookup("research"), { ...keys, openAlexApiKey: " " })).toMatchObject({ status: "unavailable", reason: "provider_down" });
  expect(fetcher).not.toHaveBeenCalled();
  await discoverEnrichment(owner, lookup("research"), keys);
  await discoverEnrichment(owner, lookup("public_profile"), keys);
  for (const [request] of fetcher.mock.calls) expect(String(request)).not.toContain("recorded-");
  const refused = await discoverEnrichment(owner, { ...lookup("research"), name: "Private Person" }, keys).catch((error: Error) => error);
  expect(`${(refused as Error).message} ${JSON.stringify(refused)}`).not.toMatch(/Private Person|recorded-/);
  for (const log of logs) expect(log).not.toHaveBeenCalled();
});

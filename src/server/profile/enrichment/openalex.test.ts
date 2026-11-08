import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enrichmentIdentity } from "@/contracts/fixtures/enrichment";
import type { RouteBody } from "@/contracts/routes";
import { findResearchAuthors, collectResearchPapers } from "./openalex";

const key = "recorded-openalex-key";
const lookup: RouteBody<"discoverEnrichment"> = { source: "research", name: "Ada Example", workplaceName: null, rorId: null, orcid: null };
const author = (id = "A101", affiliation = "Example University") => ({
  id: `https://openalex.org/${id}`, display_name: "Ada <b>Example</b>", orcid: null, works_count: 12,
  affiliations: [{ institution: { id: "https://openalex.org/I101", display_name: affiliation }, years: [2025, 2026] }],
});
const work = (id = "W101", authorId = "A101") => ({
  id: `https://openalex.org/${id}`, display_name: "Graphs <i>and</i> systems &amp; proofs", publication_year: 2025,
  doi: `https://doi.org/10.1234/${id.toLowerCase()}`,
  authorships: [{ author: { id: `https://openalex.org/${authorId}` } }],
  abstract_inverted_index: { Reliable: [0], systems: [1], research: [2] },
});
const fetcher = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const enqueue = (...bodies: unknown[]) => bodies.forEach(body => fetcher.mockResolvedValueOnce(json(body)));
const url = (index = 0) => new URL(String(fetcher.mock.calls[index][0]));
beforeEach(() => { fetcher.mockReset(); vi.stubGlobal("fetch", fetcher); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("returns clickable plain-text author previews with one batched metadata query", async () => {
  enqueue({ results: [author(), author("A102")] }, { results: [work(), work("W102", "A102")] });
  const found = await findResearchAuthors(lookup, key);
  expect(found).toHaveLength(2);
  expect(found[0]).toMatchObject({ id: "A101", name: "Ada Example", url: "https://openalex.org/A101", worksCount: 12,
    affiliations: [{ name: "Example University", years: [2025, 2026] }],
    samplePapers: [{ title: "Graphs and systems & proofs", year: 2025, url: "https://doi.org/10.1234/w101" }] });
  expect(url().searchParams.get("search")).toBe("Ada Example");
  expect(url(1).searchParams.get("filter")).toBe("authorships.author.id:A101|A102");
  expect(url(1).searchParams.get("select")).not.toContain("abstract");
  expect(fetcher).toHaveBeenCalledTimes(2);
  for (const [request, options] of fetcher.mock.calls) {
    expect(new URL(String(request)).origin).toBe("https://api.openalex.org");
    expect(String(request)).not.toContain(key);
    expect(new URL(String(request)).searchParams.has("api_key")).toBe(false);
    expect(options).toMatchObject({ redirect: "error", cache: "no-store", headers: { Authorization: `Bearer ${key}` } });
  }
});

it("searches by ORCID without narrowing it by a possibly stale name or workplace", async () => {
  enqueue({ results: [author()] }, { results: [] });
  await findResearchAuthors({ ...lookup, name: enrichmentIdentity.name, workplaceName: enrichmentIdentity.workplaceName, orcid: "0000-0002-1825-0097" }, key);
  expect(url().searchParams.get("filter")).toBe("orcid:0000-0002-1825-0097");
  expect(url().searchParams.has("search")).toBe(false);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("resolves an exact ROR and searches historical affiliations", async () => {
  enqueue({ id: "https://openalex.org/I101" }, { results: [author()] }, { results: [] });
  await findResearchAuthors({ ...lookup, rorId: "https://ror.org/03yrm5c26" }, key);
  expect(url().pathname).toBe("/institutions/ror:03yrm5c26");
  expect(url(1).searchParams.get("filter")).toBe("affiliations.institution.id:I101");
  expect(url(1).searchParams.get("search")).toBe("Ada Example");
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it("ranks a typed workplace match first, deduplicates authors and returns at most four", async () => {
  enqueue({ results: [author(), author(), ...Array.from({ length: 5 }, (_, n) => author(`A${n + 102}`, n === 4 ? "Target Institute" : "Other University"))] }, { results: [] });
  const found = await findResearchAuthors({ ...lookup, workplaceName: "target institute" }, key);
  expect(found).toHaveLength(4);
  expect(found[0].id).toBe("A106");
  expect(new Set(found.map(a => a.id)).size).toBe(4);
});

it("preserves valid no-matches without fetching previews", async () => {
  enqueue({ results: [] });
  expect(await findResearchAuthors(lookup, key)).toEqual([]);
  expect(fetcher).toHaveBeenCalledOnce();
});

it("falls back to name search when a ROR has no OpenAlex mapping", async () => {
  fetcher.mockResolvedValueOnce(new Response(null, { status: 404 }));
  enqueue({ results: [author()] }, { results: [] });
  expect(await findResearchAuthors({ ...lookup, rorId: "https://ror.org/03yrm5c26" }, key)).toMatchObject([{ id: "A101" }]);
  expect(url(1).searchParams.get("search")).toBe(lookup.name);
  expect(url(1).searchParams.has("filter")).toBe(false);
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it("offers name candidates when the supplied workplace has no matching author, without assuming a current affiliation", async () => {
  enqueue({ id: "https://openalex.org/I101" }, { results: [] }, { results: [author("A102", "Previous University")] }, { results: [] });
  const found = await findResearchAuthors({ ...lookup, rorId: "https://ror.org/03yrm5c26" }, key);
  expect(found[0]).toMatchObject({ id: "A102", affiliations: [{ name: "Previous University" }] });
  expect(url(2).searchParams.get("search")).toBe(lookup.name);
  expect(url(2).searchParams.has("filter")).toBe(false);
  expect(fetcher).toHaveBeenCalledTimes(4);
});

it("normalizes ORCID URLs and bounds affiliation and paper previews", async () => {
  const person = { ...author(), orcid: "https://orcid.org/0000-0002-1825-0097" };
  person.affiliations = Array.from({ length: 5 }, () => ({ institution: { id: "https://openalex.org/I101", display_name: "University" }, years: [2025] }));
  enqueue({ results: [person] }, { results: Array.from({ length: 5 }, (_, n) => work(`W${n + 100}`)) });
  const [found] = await findResearchAuthors(lookup, key);
  expect(found.orcid).toBe("0000-0002-1825-0097");
  expect(found.affiliations).toHaveLength(3);
  expect(found.samplePapers).toHaveLength(3);
});

it("collects only the selected author's bounded evidence and deduplicates by DOI and work ID", async () => {
  const first = work();
  enqueue({ results: [first, first, { ...work("W102"), doi: first.doi!.toUpperCase() }, work("W103", "A999"), ...Array.from({ length: 12 }, (_, n) => work(`W${n + 200}`))] });
  const docs = await collectResearchPapers("google:101", "A101", key);
  expect(docs).toHaveLength(10);
  expect(docs[0]).toMatchObject({ id: "google:101:paper:W101", personId: "google:101", sourceId: "google:101:research",
    source: "research", kind: "paper", title: "Graphs and systems & proofs", excerpt: "Graphs and systems & proofs\nReliable systems research", url: first.doi });
  expect(docs.some(d => d.id.endsWith(":W102") || d.id.endsWith(":W103"))).toBe(false);
  expect(url().searchParams.get("filter")).toBe("authorships.author.id:A101");
  expect(fetcher).toHaveBeenCalledOnce();
});

it("uses only the title when an abstract is missing or malformed, with a safe public link", async () => {
  enqueue({ results: [{ ...work(), doi: "javascript:alert(1)", abstract_inverted_index: null },
    { ...work("W102"), abstract_inverted_index: { bad: [Number.MAX_SAFE_INTEGER] } }] });
  const docs = await collectResearchPapers("google:101", "A101", key);
  expect(docs[0]).toMatchObject({ excerpt: "Graphs and systems & proofs", url: "https://openalex.org/W101" });
  expect(docs[1].excerpt).toBe("Graphs and systems & proofs");
});

it("skips legitimate untitled works without losing the other papers or author previews", async () => {
  enqueue({ results: [author()] }, { results: [{ ...work("W102"), display_name: null }, work()] },
    { results: [{ ...work("W102"), display_name: null }, work()] });
  const [found] = await findResearchAuthors(lookup, key);
  expect(found.samplePapers).toHaveLength(1);
  expect((await collectResearchPapers("google:101", "A101", key)).map(p => p.id)).toEqual(["google:101:paper:W101"]);
});

it("verifies a potentially truncated authorship list with a bounded singleton request", async () => {
  const otherAuthors = Array.from({ length: 100 }, (_, n) => ({ author: { id: `https://openalex.org/A${n + 200}` } }));
  const paper = { ...work(), authorships: otherAuthors };
  enqueue({ results: [paper] }, { id: paper.id, authorships: [...otherAuthors, { author: { id: "https://openalex.org/A101" } }] });
  expect(await collectResearchPapers("google:101", "A101", key)).toMatchObject([{ id: "google:101:paper:W101" }]);
  expect(url(1).pathname).toBe("/works/W101");
  expect(url(1).searchParams.get("select")).toBe("id,authorships");
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("also verifies truncated authorships for bounded preview samples", async () => {
  const otherAuthors = Array.from({ length: 100 }, (_, n) => ({ author: { id: `https://openalex.org/A${n + 200}` } }));
  enqueue({ results: [author()] }, { results: [{ ...work(), authorships: otherAuthors }] },
    { id: "https://openalex.org/W101", authorships: [...otherAuthors, { author: { id: "https://openalex.org/A101" } }] });
  expect((await findResearchAuthors(lookup, key))[0].samplePapers).toHaveLength(1);
});

it("rejects a singleton for a different work instead of attaching its authorship", async () => {
  const authorships = Array.from({ length: 100 }, (_, n) => ({ author: { id: `https://openalex.org/A${n + 200}` } }));
  enqueue({ results: [{ ...work(), authorships }] }, { id: "https://openalex.org/W999", authorships: work().authorships });
  await expect(collectResearchPapers("google:101", "A101", key)).rejects.toMatchObject({ code: "provider_down" });
});

it("bounds singleton verification instead of silently returning an unverified empty collection", async () => {
  const authorships = Array.from({ length: 100 }, (_, n) => ({ author: { id: `https://openalex.org/A${n + 200}` } }));
  enqueue({ results: Array.from({ length: 20 }, (_, n) => ({ ...work(`W${n + 100}`), authorships })) },
    ...Array.from({ length: 10 }, (_, n) => ({ id: `https://openalex.org/W${n + 100}`, authorships })));
  await expect(collectResearchPapers("google:101", "A101", key)).rejects.toMatchObject({ code: "provider_down" });
  expect(fetcher).toHaveBeenCalledTimes(11);
});

it("reports an unverifiable singleton at the upstream 5000-author limit as unavailable", async () => {
  const authorships = Array.from({ length: 5000 }, (_, n) => ({ author: { id: `https://openalex.org/A${n + 200}` } }));
  enqueue({ results: [{ ...work(), authorships: authorships.slice(0, 100) }] }, { id: "https://openalex.org/W101", authorships });
  await expect(collectResearchPapers("google:101", "A101", key)).rejects.toMatchObject({ code: "provider_down" });
});

it("limits exceptional preview verification to four papers", async () => {
  const authorships = Array.from({ length: 100 }, (_, n) => ({ author: { id: `https://openalex.org/A${n + 200}` } }));
  enqueue({ results: [author()] }, { results: Array.from({ length: 5 }, (_, n) => ({ ...work(`W${n + 100}`), authorships })) },
    ...Array.from({ length: 4 }, (_, n) => ({ id: `https://openalex.org/W${n + 100}`, authorships: [...authorships, ...work().authorships] })));
  expect((await findResearchAuthors(lookup, key))[0].samplePapers).toHaveLength(3);
  expect(fetcher).toHaveBeenCalledTimes(6);
});

it("does not rebuild an abstract with missing words into a misleading sentence", async () => {
  enqueue({ results: [{ ...work(), abstract_inverted_index: { Systems: [0], safe: [2] } }] });
  expect((await collectResearchPapers("google:101", "A101", key))[0].excerpt).toBe("Graphs and systems & proofs");
});

it("bounds reconstructed abstracts and removes escaped markup", async () => {
  enqueue({ results: [{ ...work(), display_name: "&lt;i&gt;Systems&lt;/i&gt;", abstract_inverted_index: Object.fromEntries(Array.from({ length: 1000 }, (_, n) => [`word${n}`, [n]])) }] });
  const [doc] = await collectResearchPapers("google:101", "A101", key);
  expect(doc.title).toBe("Systems");
  expect(doc.excerpt.length).toBeLessThanOrEqual(3000);
});

it.each(["https://elsewhere.example/A101", "A101,authorships.author.id:A999", "../authors/A101"])("rejects an untrusted selected author ID: %s", async id => {
  await expect(collectResearchPapers("google:101", id, key)).rejects.toMatchObject({ code: "invalid_input", status: 400 });
  expect(fetcher).not.toHaveBeenCalled();
});

it("requires configuration before making any request", async () => {
  await expect(findResearchAuthors(lookup, "")).rejects.toMatchObject({ code: "provider_down", status: 503 });
  expect(fetcher).not.toHaveBeenCalled();
});

it("reports a bounded rate-limit retry hint without provider error text", async () => {
  fetcher.mockResolvedValueOnce(json({ private: key }, 429, { "Retry-After": "99999999" }));
  await expect(findResearchAuthors(lookup, key)).rejects.toMatchObject({ code: "rate_limited", retryAfterSeconds: 86400 });
});

it("reports a timeout without retaining the thrown error", async () => {
  fetcher.mockRejectedValueOnce(new DOMException(key, "TimeoutError"));
  await expect(findResearchAuthors(lookup, key)).rejects.toMatchObject({ code: "timeout", status: 503 });
});

it("cancels an oversized streamed body even without a Content-Length header", async () => {
  const cancel = vi.fn();
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(1048577)); }, cancel });
  fetcher.mockResolvedValueOnce(new Response(stream, { headers: { "Content-Type": "application/json" } }));
  await expect(findResearchAuthors(lookup, key)).rejects.toMatchObject({ code: "provider_down", status: 503 });
  expect(cancel).toHaveBeenCalledOnce();
});

it.each(["malformed", "oversized", "redirect", "transport", "wrong content type"])("sanitizes %s provider failures", async failure => {
  if (failure === "malformed") enqueue({ private: key });
  if (failure === "oversized") fetcher.mockResolvedValueOnce(json({}, 200, { "Content-Length": "1048577" }));
  if (failure === "redirect") fetcher.mockResolvedValueOnce(new Response(key, { status: 302 }));
  if (failure === "transport") fetcher.mockRejectedValueOnce(new Error(`provider-secret ${key}`));
  if (failure === "wrong content type") fetcher.mockResolvedValueOnce(new Response(`<html>${key}</html>`, { headers: { "Content-Type": "text/html" } }));
  const error = await findResearchAuthors(lookup, key).catch(e => e);
  expect(error).toMatchObject({ code: "provider_down", status: 503 });
  expect(String(error)).not.toContain(key);
  expect(error).not.toHaveProperty("cause");
});

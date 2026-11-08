import { z } from "zod";
import type { RouteBody, RouteResponse } from "@/contracts/routes";
import { DiscoverEnrichment, EnrichmentEvidence } from "@/contracts/enrichment";
import { enrichmentError, StateError } from "./model";

type Candidates = Extract<RouteResponse<"discoverEnrichment">, { source: "research" }>["candidates"];
const MAX_BYTES = 1024 * 1024;
const authorId = z.string().max(100).regex(/^https:\/\/openalex\.org\/A[1-9]\d*$/);
const workId = z.string().max(100).regex(/^https:\/\/openalex\.org\/W[1-9]\d*$/);
const rawAuthor = z.object({
  id: authorId, display_name: z.string().max(2000), orcid: z.string().max(100).nullish(), works_count: z.number().int().nonnegative(),
  affiliations: z.array(z.object({ institution: z.object({ display_name: z.string().max(2000) }),
    years: z.array(z.number().int().min(1000).max(2100)).max(200).nullish() })).max(500).nullish(),
});
const authorResponse = z.object({ results: z.array(rawAuthor).max(20) });
const rawWork = z.object({
  id: workId, display_name: z.string().max(10_000).nullable(), publication_year: z.number().int().min(1000).max(2100).nullable(),
  doi: z.string().max(2000).nullish(), authorships: z.array(z.object({ author: z.object({ id: authorId.nullable() }) })).max(100),
  abstract_inverted_index: z.unknown().optional(),
});
const abstracts = z.record(z.string().max(2000), z.array(z.number().int().min(0).max(4095)).max(4096));

function plainText(text: string, maximum: number): string {
  const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, entity: string) => {
    if (entity[0] !== "#") return entities[entity.toLowerCase()];
    const value = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return value > 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff) ? String.fromCodePoint(value) : " ";
  }).replace(/<[^<>]*>/g, " ").replace(/[<>\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function abstractText(value: unknown): string {
  if (value === null || value === undefined) return "";
  const parsed = abstracts.safeParse(value);
  if (!parsed.success || Object.keys(parsed.data).length > 4096) return "";
  const words = new Map<number, string>();
  let total = 0;
  for (const [word, positions] of Object.entries(parsed.data)) {
    total += positions.length;
    if (total > 4096) return "";
    for (const position of positions) {
      if (words.has(position)) return "";
      words.set(position, word);
    }
  }
  const ordered = [...words].sort(([a], [b]) => a - b);
  if (ordered.some(([position], index) => position !== index)) return "";
  return plainText(ordered.map(([, word]) => word).join(" "), 3000);
}

function paperLink(work: z.infer<typeof rawWork>): { url: string; doi: string | null } {
  try {
    const url = new URL(work.doi ?? "");
    const doi = decodeURIComponent(url.pathname.slice(1));
    if (["http:", "https:"].includes(url.protocol) && ["doi.org", "dx.doi.org"].includes(url.hostname)
      && !url.username && !url.password && !url.port && !url.search && !url.hash && /^10\.\d{4,9}\/\S+$/i.test(doi)) {
      return { url: `https://doi.org/${url.pathname.slice(1)}`, doi: doi.toLowerCase() };
    }
  } catch { /* Missing or malformed DOI falls back to the public OpenAlex work page. */ }
  return { url: work.id, doi: null };
}

async function readJson(response: Response): Promise<unknown> {
  if (Number(response.headers.get("Content-Length")) > MAX_BYTES || !response.headers.get("Content-Type")?.includes("application/json")) {
    enrichmentError("provider_down", 503);
  }
  const reader = response.body?.getReader();
  if (!reader) enrichmentError("provider_down", 503);
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BYTES) { await reader.cancel(); enrichmentError("provider_down", 503); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

async function request(resource: string, params: Record<string, string>, apiKey: string, signal: AbortSignal): Promise<unknown> {
  if (!apiKey.trim()) enrichmentError("provider_down", 503);
  const url = new URL(`https://api.openalex.org/${resource}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  try {
    const response = await fetch(url, { headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}` }, cache: "no-store", redirect: "error", signal });
    if (response.status === 404 && resource.startsWith("institutions/")) return null;
    if (response.status === 429) {
      const hint = Number(response.headers.get("Retry-After"));
      enrichmentError("rate_limited", 429, Number.isFinite(hint) && hint > 0 ? Math.min(86400, Math.max(1, Math.ceil(hint))) : 60);
    }
    if (!response.ok) enrichmentError("provider_down", 503);
    return await readJson(response);
  } catch (error) {
    if (error instanceof StateError) throw error;
    enrichmentError(signal.aborted || (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) ? "timeout" : "provider_down", 503);
  }
}

async function works(ids: string[], apiKey: string, signal: AbortSignal, includeAbstract: boolean) {
  const value = await request("works", { filter: `authorships.author.id:${ids.join("|")}`, "per-page": includeAbstract ? "20" : "40",
    sort: "publication_date:desc", select: `id,display_name,publication_year,doi,authorships${includeAbstract ? ",abstract_inverted_index" : ""}` }, apiKey, signal);
  const papers = z.object({ results: z.array(rawWork).max(40) }).parse(value).results
    .filter(p => p.display_name !== null && plainText(p.display_name, 300));
  return [...new Map(papers.map(p => [p.id, p])).values()];
}

async function fullAuthorships(paper: z.infer<typeof rawWork>, apiKey: string, signal: AbortSignal) {
  // List responses truncate at 100; only singleton responses can verify an author beyond that boundary.
  const value = await request(`works/${paper.id.split("/").at(-1)}`, { select: "id,authorships" }, apiKey, signal);
  const full = rawWork.pick({ id: true }).extend({ authorships: z.array(rawWork.shape.authorships.element).max(5000) }).parse(value);
  if (full.id !== paper.id) enrichmentError("provider_down", 503);
  return full.authorships;
}

/** Preview metadata only; an author remains unselected until the owner confirms a candidate. */
export async function findResearchAuthors(input: RouteBody<"discoverEnrichment">, apiKey: string): Promise<Candidates> {
  const lookup = DiscoverEnrichment.parse(input);
  if (lookup.source !== "research") enrichmentError("invalid_input", 400);
  const signal = AbortSignal.timeout(10_000);
  try {
    const params: Record<string, string> = { "per-page": lookup.workplaceName ? "20" : "4", select: "id,display_name,orcid,works_count,affiliations" };
    if (lookup.orcid) params.filter = `orcid:${lookup.orcid}`;
    else {
      params.search = lookup.name;
      if (lookup.rorId) {
        const institution = await request(`institutions/ror:${lookup.rorId.split("/").at(-1)}`, { select: "id" }, apiKey, signal);
        if (institution !== null) {
          const id = z.object({ id: z.string().max(100).regex(/^https:\/\/openalex\.org\/I[1-9]\d*$/) }).parse(institution).id.split("/").at(-1)!;
          params.filter = `affiliations.institution.id:${id}`;
        }
      }
    }
    let raw = authorResponse.parse(await request("authors", params, apiKey, signal)).results;
    if (!raw.length && params.filter?.startsWith("affiliations.")) {
      // A new workplace may have no publications yet; broader candidates still require confirmation.
      delete params.filter;
      raw = authorResponse.parse(await request("authors", params, apiKey, signal)).results;
    }
    const unique = [...new Map(raw.map(a => [a.id, a])).values()];
    const workplace = lookup.workplaceName?.toLowerCase().trim();
    const score = (a: z.infer<typeof rawAuthor>) => workplace && a.affiliations?.some(f => plainText(f.institution.display_name, 200).toLowerCase().includes(workplace)) ? 1 : 0;
    const authors = unique.sort((a, b) => score(b) - score(a)).filter(a => plainText(a.display_name, 200)).slice(0, 4);
    if (!authors.length) return [];
    const papers = await works(authors.map(a => a.id.split("/").at(-1)!), apiKey, signal, false);
    for (const paper of papers.filter(p => p.authorships.length === 100).slice(0, 4)) {
      paper.authorships = await fullAuthorships(paper, apiKey, signal);
    }
    return authors.map(a => ({
      id: a.id.split("/").at(-1)!, name: plainText(a.display_name, 200), url: a.id,
      orcid: /^https:\/\/orcid\.org\/\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(a.orcid ?? "") ? a.orcid!.slice(18) : null,
      affiliations: (a.affiliations ?? []).slice(0, 3).map(f => ({ name: plainText(f.institution.display_name, 200), years: f.years?.slice(0, 100) ?? null })),
      worksCount: a.works_count,
      samplePapers: [...new Map(papers.filter(p => p.authorships.some(s => s.author.id === a.id)).map(p => [p.id, p])).values()]
        .slice(0, 3).map(p => ({ title: plainText(p.display_name ?? "", 300), year: p.publication_year, url: paperLink(p).url })),
    }));
  } catch (error) {
    if (error instanceof StateError) throw error;
    enrichmentError("provider_down", 503);
  }
}

/** Called by the future lease-checked worker with the author ID from its saved, confirmed selection. */
export async function collectResearchPapers(owner: string, selectedAuthorId: string, apiKey: string): Promise<z.infer<typeof EnrichmentEvidence>[]> {
  if (selectedAuthorId.length > 60 || !/^A[1-9]\d*$/.test(selectedAuthorId)) enrichmentError("invalid_input", 400);
  const signal = AbortSignal.timeout(10_000);
  try {
    const papers = await works([selectedAuthorId], apiKey, signal, true);
    const seenIds = new Set<string>(); const seenDois = new Set<string>();
    const result: z.infer<typeof EnrichmentEvidence>[] = [];
    let verifications = 0;
    for (const paper of papers) {
      const link = paperLink(paper); const title = plainText(paper.display_name ?? "", 300);
      if (!title || seenIds.has(paper.id) || (link.doi && seenDois.has(link.doi))) continue;
      const isSelectedAuthor = (a: { author: { id: string | null } }) => a.author.id === `https://openalex.org/${selectedAuthorId}`;
      if (!paper.authorships.some(isSelectedAuthor) && paper.authorships.length === 100) {
        if (verifications >= 10) enrichmentError("provider_down", 503);
        verifications++;
        paper.authorships = await fullAuthorships(paper, apiKey, signal);
      }
      if (!paper.authorships.some(isSelectedAuthor)) {
        if (paper.authorships.length === 5000) enrichmentError("provider_down", 503);
        continue;
      }
      const abstract = abstractText(paper.abstract_inverted_index);
      const doc = EnrichmentEvidence.parse({ id: `${owner}:paper:${paper.id.split("/").at(-1)}`, personId: owner,
        sourceId: `${owner}:research`, source: "research", kind: "paper", title,
        excerpt: (title + (abstract ? `\n${abstract}` : "")).slice(0, 3000), url: link.url, retrievedAt: new Date().toISOString() });
      result.push(doc); seenIds.add(paper.id); if (link.doi) seenDois.add(link.doi);
      if (result.length === 10) break;
    }
    return result;
  } catch (error) {
    if (error instanceof StateError) throw error;
    enrichmentError("provider_down", 503);
  }
}

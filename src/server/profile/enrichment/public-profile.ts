/**
 * Public professional profile: Brave Web Search suggests at most four pages
 * (previews only, never evidence and never chosen for the person); after the
 * person confirms one, only that page is read. Pasted text is the fallback.
 * Credentials are explicit arguments. Nothing here logs page or pasted text.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { DiscoverEnrichment, EnrichmentEvidence, MAX_SOURCE_TEXT } from "@/contracts/enrichment";
import type { RouteBody, RouteResponse } from "@/contracts/routes";
import { readProviderJson } from "../provider-json";
import { enrichmentError, StateError } from "./model";
import { bounded, decodePage, hasLoginForm, htmlToText, oneLine, pageTitle, robotsAllows, robotsDirectiveBlocks, tidyText } from "./page-text";
import { fetchPublic, PageFetchError, safeUrl, type Fetched } from "./safe-fetch";

type Candidates = Extract<RouteResponse<"discoverEnrichment">, { source: "public_profile" }>["candidates"];
type Evidence = z.infer<typeof EnrichmentEvidence>;

const MAX_CANDIDATES = 4;
const MAX_PAGE_BYTES = 1024 * 1024;
const MAX_ROBOTS_BYTES = 512 * 1024;
const EXCERPT = 3000;
const DEADLINE_MS = 10_000;
const ROBOTS_TOKEN = "Lanyard";

// Login-walled sites this release doesn't import (LinkedIn scraping is out of scope); offering them would only fail.
const LOGIN_WALLED = ["linkedin.com", "facebook.com", "instagram.com", "x.com", "twitter.com", "tiktok.com"];
const onHost = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);
/** "/a/b//" → "/a/b", in linear time (a /\/+$/ regex backtracks on long runs of slashes). */
function withoutTrailingSlashes(path: string): string {
  let end = path.length;
  while (end > 0 && path[end - 1] === "/") end--;
  return path.slice(0, end);
}

const braveResults = z.object({
  web: z.object({
    results: z.array(z.object({ title: z.string().max(2000), url: z.string().max(4096), description: z.string().max(5000).nullish() })).max(20),
  }).nullish(),
});
const rorRecord = z.object({
  domains: z.array(z.string().max(253)).max(20).nullish(),
  links: z.array(z.object({ type: z.string().max(50), value: z.string().max(2048) })).max(20).nullish(),
});

function retryHint(headers: Headers): number {
  const after = Number(headers.get("Retry-After"));
  if (Number.isFinite(after) && after > 0) return Math.min(86_400, Math.ceil(after));
  // Brave: comma-separated windows; the exhausted window's reset is the wait.
  const remaining = (headers.get("X-RateLimit-Remaining") ?? "").split(",").map((v) => v.trim());
  const resets = (headers.get("X-RateLimit-Reset") ?? "").split(",").map(Number);
  const waits = resets.filter((seconds, index) => remaining[index] === "0" && Number.isFinite(seconds) && seconds > 0);
  return waits.length ? Math.min(86_400, Math.ceil(Math.max(...waits))) : 60;
}

async function providerJson(url: URL, headers: Record<string, string>, signal: AbortSignal): Promise<unknown> {
  try {
    const response = await fetch(url, { headers: { Accept: "application/json", ...headers }, cache: "no-store", redirect: "error", signal });
    if (response.status === 429) enrichmentError("rate_limited", 429, retryHint(response.headers));
    if (!response.ok) enrichmentError("provider_down", 503);
    return await readProviderJson(response);
  } catch (error) {
    if (error instanceof StateError) throw error;
    enrichmentError(signal.aborted || (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name)) ? "timeout" : "provider_down", 503);
  }
}

/** The confirmed organisation's web domains from ROR (keyless). A failure only loses the ranking hint. */
async function organisationDomains(rorId: string, signal: AbortSignal): Promise<string[]> {
  try {
    // Its own short limit, so a slow ROR can't use up the search's time.
    const limited = AbortSignal.any([signal, AbortSignal.timeout(3_000)]);
    const record = rorRecord.parse(await providerJson(new URL(`https://api.ror.org/v2/organizations/${rorId.split("/").at(-1)}`), {}, limited));
    const fromLinks = (record.links ?? []).filter((l) => l.type === "website").map((l) => safeUrl(l.value)?.hostname);
    return [...(record.domains ?? []), ...fromLinks]
      .filter((d): d is string => !!d)
      .map((d) => d.toLowerCase().replace(/^www\./, ""))
      .filter((d) => /^[a-z\d.-]+\.[a-z]{2,}$/.test(d));
  } catch {
    return [];
  }
}

/** Candidate pages for page two: HTTPS, deduplicated, plain text, at most four, none selected. */
export async function findPublicProfilePages(input: RouteBody<"discoverEnrichment">, apiKey: string): Promise<Candidates> {
  const parsed = DiscoverEnrichment.safeParse(input);
  if (!parsed.success || parsed.data.source !== "public_profile") enrichmentError("invalid_input", 400);
  if (!apiKey.trim()) enrichmentError("provider_down", 503);
  const { name, workplaceName, rorId } = parsed.data;
  const signal = AbortSignal.timeout(DEADLINE_MS);
  const domains = rorId ? await organisationDomains(rorId, signal) : [];

  const quote = (text: string) => text.replace(/["\u0000-\u001f]/g, " ").trim();
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", `"${quote(name)}"${workplaceName ? ` ${quote(workplaceName)}` : ""}`);
  url.searchParams.set("count", "10");
  url.searchParams.set("result_filter", "web");
  url.searchParams.set("safesearch", "strict");
  url.searchParams.set("text_decorations", "false");
  const results = braveResults.safeParse(await providerJson(url, { "X-Subscription-Token": apiKey }, signal));
  if (!results.success) enrichmentError("provider_down", 503);

  const seen = new Set<string>();
  const candidates: Candidates = [];
  for (const result of results.data.web?.results ?? []) {
    const page = safeUrl(result.url);
    if (!page || LOGIN_WALLED.some((d) => onHost(page.hostname, d)) || /\.(pdf|docx?|pptx?|xlsx?|zip)$/i.test(page.pathname)) continue;
    const key = `${page.hostname.replace(/^www\./, "")}${withoutTrailingSlashes(page.pathname)}${page.search}`;
    const title = oneLine(result.title, 200);
    if (!title || seen.has(key)) continue;
    seen.add(key);
    candidates.push({
      id: createHash("sha256").update(page.href).digest("base64url").slice(0, 16),
      title, url: page.href, domain: page.hostname, snippet: oneLine(result.description ?? "", 300),
    });
  }
  // Pages on the confirmed organisation's own domain first; otherwise the search's order.
  const own = (c: Candidates[number]) => (domains.some((d) => onHost(c.domain, d)) ? 0 : 1);
  return candidates.sort((a, b) => own(a) - own(b)).slice(0, MAX_CANDIDATES);
}

const pageFailure = {
  unsafe: ["page_unavailable", 502], unavailable: ["page_unavailable", 502], too_large: ["page_unavailable", 502],
  unsupported: ["page_unavailable", 502], timeout: ["timeout", 503], blocked: ["page_blocked", 422],
} as const;

/**
 * A run's robots.txt check, per RFC 9309: each site's file is read once; 4xx means no rules,
 * 5xx or no answer means not now. Used for the confirmed page and before every redirect hop.
 */
function robotsCheck(signal: AbortSignal): (url: URL) => Promise<boolean> {
  const sites = new Map<string, Promise<string | null>>();
  const rules = async (url: URL): Promise<string | null> => {
    const robots = await fetchPublic(new URL("/robots.txt", url), { accept: "text/plain", types: /^/, maxBytes: MAX_ROBOTS_BYTES, signal });
    if (robots.status >= 400 && robots.status < 500) return null;
    if (!robots.body) enrichmentError("page_unavailable", 502);
    return decodePage(robots.body, robots.headers["content-type"]);
  };
  return async (url) => {
    let site = sites.get(url.origin);
    if (!site) sites.set(url.origin, (site = rules(url)));
    const text = await site;
    return text === null || robotsAllows(text, `${url.pathname}${url.search}`, ROBOTS_TOKEN);
  };
}

function pageEvidence(owner: string, confirmed: URL, fetched: Fetched): Evidence {
  const html = decodePage(fetched.body!, fetched.headers["content-type"]);
  const plain = /^text\/plain/i.test(fetched.headers["content-type"] ?? "");
  if (robotsDirectiveBlocks(plain ? "" : html, fetched.headers["x-robots-tag"], ROBOTS_TOKEN) || (!plain && hasLoginForm(html))) {
    enrichmentError("page_blocked", 422);
  }
  const text = plain ? tidyText(html) : htmlToText(html);
  if (!text) enrichmentError("page_unavailable", 502);
  return EnrichmentEvidence.parse({
    id: `${owner}:profile_page:public-page`, personId: owner, sourceId: `${owner}:public_profile`,
    source: "public_profile", kind: "profile_page",
    title: (!plain && pageTitle(html)) || fetched.url.hostname, excerpt: bounded(text, EXCERPT),
    // The link the person confirmed, not a redirect target (which may carry session parameters).
    url: confirmed.href, retrievedAt: new Date().toISOString(),
  });
}

/**
 * Reads the person's confirmed page (one URL, no crawling), or uses their
 * pasted text. The future runner passes the owner-bound saved selection and
 * checks its lease; this is not an authorization boundary.
 */
export async function collectPublicProfile(owner: string, choice: { url: string } | { kind: "text"; text: string }): Promise<Evidence> {
  if ("text" in choice) {
    const text = tidyText(choice.text);
    if (!text || choice.text.length > MAX_SOURCE_TEXT) enrichmentError("invalid_input", 400);
    // Neutral title and no URL: pasted text has no page to point at.
    return EnrichmentEvidence.parse({
      id: `${owner}:profile_page:public-text`, personId: owner, sourceId: `${owner}:public_profile`,
      source: "public_profile", kind: "profile_page", title: "Profile text", excerpt: bounded(text, EXCERPT),
      retrievedAt: new Date().toISOString(),
    });
  }
  const page = safeUrl(choice.url);
  if (!page) enrichmentError("page_unavailable", 422);
  const signal = AbortSignal.timeout(DEADLINE_MS);
  try {
    // robots.txt applies to the page and to every redirect target, each checked before it's requested.
    const allow = robotsCheck(signal);
    if (!(await allow(page))) enrichmentError("page_blocked", 422);
    const fetched = await fetchPublic(page, {
      accept: "text/html,application/xhtml+xml;q=0.9,text/plain;q=0.5", types: /^(text\/html|application\/xhtml\+xml|text\/plain)\b/i,
      maxBytes: MAX_PAGE_BYTES, signal, allow,
    });
    if ([401, 403, 407, 451].includes(fetched.status)) enrichmentError("page_blocked", 422);
    if (fetched.status === 429) enrichmentError("rate_limited", 429, retryHint(new Headers({ "Retry-After": String(fetched.headers["retry-after"] ?? "") })));
    if (!fetched.body) enrichmentError("page_unavailable", 502);
    return pageEvidence(owner, page, fetched);
  } catch (error) {
    if (error instanceof StateError) throw error;
    if (error instanceof PageFetchError) {
      const [code, status] = pageFailure[error.failure];
      enrichmentError(code, status);
    }
    enrichmentError("page_unavailable", 502);
  }
}

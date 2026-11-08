/**
 * Page two's candidate search, one source per request: OpenAlex authors for
 * research, Brave pages for a public profile. The attempt is counted durably
 * before any provider is contacted; a result that finishes after the owner's
 * identity or consent generation changed is refused, not kept. Credentials are
 * explicit arguments. Nothing here logs, and no provider text reaches an error.
 */
import { randomUUID } from "node:crypto";
import { DiscoverEnrichment, EnrichmentDiscovery, type EnrichmentErrorCode } from "@/contracts/enrichment";
import type { RouteBody, RouteResponse } from "@/contracts/routes";
import { enrichmentError, StateError } from "./model";
import { findResearchAuthors } from "./openalex";
import { findPublicProfilePages } from "./public-profile";
import { DISCOVERY_TTL_MS, recordDiscovery, reserveDiscovery } from "./state";

export type DiscoveryKeys = { openAlexApiKey: string; braveSearchApiKey: string };
type Lookup = RouteBody<"discoverEnrichment">;
type Discovery = RouteResponse<"discoverEnrichment">;

/** Provider failures the screen can explain; anything else is "unknown". */
const EXPLAINED = new Set<EnrichmentErrorCode>(["rate_limited", "timeout", "provider_down"]);

async function search(lookup: Lookup, keys: DiscoveryKeys): Promise<Discovery> {
  const base = { source: lookup.source, discoveryId: randomUUID() };
  const expiresAt = () => new Date(Date.now() + DISCOVERY_TTL_MS).toISOString();
  try {
    const found = lookup.source === "research"
      ? await findResearchAuthors(lookup, keys.openAlexApiKey)
      : await findPublicProfilePages(lookup, keys.braveSearchApiKey);
    const candidates = found.slice(0, 4);
    return EnrichmentDiscovery.parse({ ...base, status: candidates.length ? "ok" : "no_matches", candidates, expiresAt: expiresAt() });
  } catch (error) {
    const explained = error instanceof StateError && EXPLAINED.has(error.code) ? error : null;
    return EnrichmentDiscovery.parse({ ...base, status: "unavailable", candidates: [], expiresAt: expiresAt(),
      reason: explained?.code ?? "unknown", ...(explained?.retryAfterSeconds ? { retryAfterSeconds: explained.retryAfterSeconds } : {}) });
  }
}

export async function discoverEnrichment(owner: string, input: Lookup, keys: DiscoveryKeys): Promise<Discovery> {
  const parsed = DiscoverEnrichment.safeParse(input);
  if (!parsed.success) enrichmentError("invalid_input", 400);
  const generation = await reserveDiscovery(owner, parsed.data);
  const value = await search(parsed.data, keys);
  await recordDiscovery(owner, parsed.data, value, generation);
  return value;
}

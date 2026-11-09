# Owner-scoped discovery

Status: service and state helpers on `b/enrichment-discovery` (base `b/enrichment-rebuild-fix` fa62354 plus `b/enrichment-public-profile` e989322). **Not wired**: `real.ts` still answers `discoverEnrichment` with 501, and there is no configuration or environment change. No contract, route, job, runner, synthesis or migration changes.

## Interface

`src/server/profile/enrichment/discovery.ts`:

```ts
export type DiscoveryKeys = { openAlexApiKey: string; braveSearchApiKey: string };
export async function discoverEnrichment(owner: string, input: RouteBody<"discoverEnrichment">, keys: DiscoveryKeys): Promise<RouteResponse<"discoverEnrichment">>;
```

`state.ts` adds `DISCOVERY_TTL_MS` (one hour) and `reserveDiscovery(owner, input)`, which returns the consent generation. `recordDiscovery(owner, input, value, generation)` now takes that generation and no longer counts the limit.

## What one request does

1. **Validate.** A body that isn't a contract discovery body returns 400 `invalid_input`.
2. **Reserve the attempt, before any provider is contacted.** In one durable owner-row mutation:
   - The lookup must equal the owner's saved page-one identity (name, workplace, ROR, ORCID; country isn't searched). Otherwise it returns 409 `selection_stale`, nothing is counted, and no provider is called.
   - The attempt is counted against the existing ten-minute limit: 12 searches, shared by both sources. Over the limit it returns 429 `rate_limited` with `retryAfterSeconds`, and no provider is called.
   - Failed, timed-out and abandoned searches have already been counted at this point.
3. **Search one source.** Research uses `findResearchAuthors` (OpenAlex). Public profile uses `findPublicProfilePages` (Brave, plus the keyless ROR domain hint).
   - **`ok`:** at most four candidates.
   - **`no_matches`:** no reason.
   - **`unavailable`:** `reason` is `rate_limited` (with the provider's `retryAfterSeconds`), `timeout` or `provider_down`. Anything else is `unknown`.
   - An empty or missing key is `provider_down`, and that provider is not called.
   - `expiresAt` is one hour after the result.
4. **Record, bound to owner, inputs and generation.** In a second mutation, the result is refused with 409 `selection_stale` and not kept if, while the search ran:
   - the generation changed (an identity change, a confirmed start, or a source withdrawal); or
   - the saved identity no longer matches.

   Only results with candidates are stored. When the 16 slots are full, the oldest list from the **same** source is evicted, so one source's repeated searches never push out the other's list.

Starting with a candidate still goes through `createJob`'s existing check. It looks only in the owner's own lists, so another account's `discoveryId` returns `selection_stale`. It also needs a matching identity and an unexpired list.

Logging and errors:
- Nothing in this service logs.
- Errors are `StateError` with the fixed message and a code.
- Provider bodies, URLs, credentials and the searched name never reach a response or error.
- Credentials go only in the providers' headers, never in a URL.

## Wiring for Codex

1. `src/server/config.ts`: add `openAlexApiKey: process.env.OPENALEX_API_KEY ?? ""` and `braveSearchApiKey: process.env.BRAVE_SEARCH_API_KEY ?? ""`. Add both to `.env.example` with no values. They are server-only.
2. `src/server/real.ts`:
   ```ts
   import { discoverEnrichment } from "@/server/profile/enrichment/discovery";
   discoverEnrichment: ({ userId, body }) => discoverEnrichment(userId, body, { openAlexApiKey: config.openAlexApiKey, braveSearchApiKey: config.braveSearchApiKey }),
   ```
   The adapter already checks the flag, origin and sign-in, parses the body, validates the response and sanitises errors. The 409, 429 and 503 errors pass through it with their codes.
3. Keep `startEnrichment`'s `not_ready` gate until the runner can collect the chosen sources.
4. Fake parity (optional, contract owner's call): the real service refuses a search whose body isn't the saved identity (409 `selection_stale`) and keeps lists for one hour; the fake accepts any body and keeps them for 24 hours. Pages 1–2 already save the identity first and read `expiresAt`, so they work with both.
5. If the screens should recover from a discovery `selection_stale` (identity changed in another tab), page 2 can reload owner state on that code. Today it shows the source's Try again, which keeps failing until a reload.

## Not done here

- Per-source limits: the stored limit names are fixed in `model.ts`.
- A live provider or Neon check.
- Collection, which is the runner's job.

## Verification

Recorded replies only (`discovery.test.ts`, plus the updated `state.test.ts` binding test):
- ownership;
- the count is saved before the first provider request;
- 12 failed searches count, and the 13th is refused without a provider call;
- refused lookups aren't counted;
- late results after an identity change or a start;
- independent sources, including eviction;
- expiry, and the one-hour bound;
- empty results;
- sanitized `rate_limited`, `timeout`, `provider_down` and malformed replies, with no console output;
- credentials out of URLs and errors.

Removing each protection in turn made its test fail: rate counted after the call, no generation check, oldest-overall eviction, no expiry bound, no identity check at reservation.

```powershell
npx vitest run src/server/profile/enrichment/discovery.test.ts src/server/profile/enrichment/state.test.ts
```

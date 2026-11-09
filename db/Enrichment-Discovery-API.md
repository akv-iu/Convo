# Real discovery API integration

Status: implemented on `b/enrichment-discovery-api`, behind the existing release switch. Development base: `origin/main` 576692d, runner e62bd82 (including acd8cb9), and discovery 4720c5e, combined at 8b0f5e0. No PR or feature sign-off. Earlier discovery handoffs describe the service before this wiring.

## Implemented

`POST /api/profile-enrichment/discover` now dispatches to the existing `discoverEnrichment(owner, input, keys)` service in real mode. The route and common adapter are unchanged: feature flag, authentication, origin and size checks, contract validation, no-store responses and sanitized errors remain in place. `FAKE_API=1` still uses the existing fake.

Research and public-profile credentials are independent. Missing selected-source credentials return HTTP 200 with the existing `unavailable`, `provider_down` discovery outcome, without fetching. The durable attempt is still counted. A configured source works even if the other key is absent. Discovery still binds candidates to the authenticated owner, saved identity and consent generation; late results return 409 `selection_stale`. Candidates expire after one hour. No source is selected, imported or published by discovery.

The unused 501 discovery placeholder was removed. Start/retry handlers, active-import `not_ready` protection, runner, synthesis, upload, cleanup, auth, screens, contracts, dependencies and migrations were not changed.

## Shared-file edits

- `src/server/real.ts`: import discovery and central config; replace only `discoverEnrichment`; remove its now-unused placeholder helper. Upload/start/retry entries stay as they were.
- `src/server/config.ts`: `openAlexApiKey` reads `OPENALEX_API_KEY ?? ""`; `braveSearchApiKey` reads `BRAVE_SEARCH_API_KEY ?? ""`.
- `.env.example`: add empty `OPENALEX_API_KEY=` and `BRAVE_SEARCH_API_KEY=` entries with a discovery comment. No actual secret file was read or modified.

These entries are separate from the CV upload dispatch and cleanup-secret entries owned by the other sessions. Preserve both sides when integrating adjacent edits.

## Eventual private setup

After the prerequisites land and the user authorizes deployment, Person B supplies `OPENALEX_API_KEY` and/or `BRAVE_SEARCH_API_KEY` privately in the intended server environment. Neither uses a `NEXT_PUBLIC_` name. Restart/redeploy after changing settings because config is read when its module loads. Never put keys in request bodies, URLs, screenshots, logs or committed files.

Leave `PROFILE_ENRICHMENT_ENABLED=0` until the complete feature, retention operations and live acceptance are ready. Adding credentials does not enable the feature. Review the chosen providers' account/display/retention terms before live enablement; this implementation does not establish account entitlement. No Vercel settings were changed.

## Complete local manual checklist

All steps below are offline checks with recorded boundaries, not live HTTP requests to providers.

1. Use this branch in its own worktree with Node 22.18+ or 24. Run `npm ci` only with a physical, worktree-owned `node_modules` directory. No `.env.local`, actual credentials, database, cluster or server is needed. Do not load a secret environment file.
2. Run `npx vitest run src/app/api/profile-enrichment/discovery.test.ts src/server/profile/enrichment/discovery-config.test.ts --maxWorkers=2`. Expected: 22 tests pass. Real API/dispatch/orchestration/state/storage run; only session lookup, Next's request-runtime connection hook, central runtime config in the API tests, Neon driver replies and provider fetches are mocked. The separate config tests load the real config with synthetic environment values.
3. The API tests check both provider headers, saved attempt before the first fetch, four-candidate bound, HTTPS/plain text, expiry, independent missing keys, empty results, sanitized 429/timeout/500/malformed replies, stale identity/consent, owner isolation, rate refusal, storage failure, flag/auth/origin boundaries and fake dispatch. The driver double accepts only private staging-table queries, so public profile writes are not permitted by the test.
4. Run `npx vitest run src/app/api/profile-enrichment src/server/profile/enrichment/discovery.test.ts src/server/profile/enrichment/discovery-config.test.ts src/server/profile/enrichment/state.test.ts src/server/profile/enrichment/storage.test.ts --maxWorkers=2`. Expected: the focused integration/state suites pass. Existing `route.test.ts` covers request-size/content/extra-field and response-contract rejection; existing discovery/provider tests cover eviction, expiry, normalization and provider boundaries without duplicating them in a second application fake.
5. Run `npm run lint`, `npm run typecheck`, then `npm test -- --coverage --coverage.reportOnFailure --maxWorkers=2`. Lint should pass. The baseline runner-test incompatibility below currently prevents a clean typecheck/full suite; do not hide it by excluding tests. Coverage may print parser warnings for committed binary/HTML/Python fixtures because the inherited coverage include is broad. Gates were not changed.
6. Cleanup: no persistent services or test accounts were created, and environment stubs restore themselves. Coverage is generated and ignored; no deployment or migration cleanup is needed. No browser suite is required for these backend-only changes.

Any live provider, real PostgreSQL concurrency, OAuth, preview or deployment test needs separate authorization and the primary integration checklist. This local checklist does not establish those behaviors.

## Verification and critical review

Tests were written first. Before wiring, 18 of the 22 new cases failed for the intended missing behavior (501 dispatch or absent config fields); the four adapter/fake guard cases already passed. After wiring, all 22 passed.

Round one: lint passed. Typecheck reported only `runner.test.ts:19` (TS2554, three arguments instead of four). Full suite with coverage: 1152 passed, one failed, 79 files. The same runner case failed in the untouched merged baseline (1130 passed, one failed, 77 files). Critical review traced the new API through the unchanged adapter, service, providers, generation checks and private storage, and checked config callers do not serialize credentials to client components. Review tightened the database double to reject writes outside the private staging table.

Round two: 118 focused API/discovery/state/storage tests passed in seven files, including all 22 new tests. Lint passed again. Typecheck again reported only the baseline TS2554 runner fixture. Full tests with coverage again produced 1152 passed and the same one failed (1153 total, 79 files); line coverage was 98.22% (2706/2755). `--coverage.reportOnFailure` generated the report without hiding the failing test or changing thresholds. The inherited fixture parser warnings remained. Second critical review found no additional defects in this slice and confirmed the protected route/adapter, runner/service, contract and migration files have no implementation diff. `git diff --check` passed.

## Remaining integration dependency

The merged runner test `collects every selected source, passes only professional excerpts to one synthesis call, and leaves a private draft` calls `recordDiscovery` at `src/server/profile/enrichment/runner.test.ts:19` using the old three-argument signature and has not staged the identity. Discovery now requires the identity to be saved and the fourth argument to come from `reserveDiscovery(owner, lookup)`. The primary runner session must update that fixture. This session did not edit runner-owned files or weaken the generation guard. Until then, the branch is reviewable but not ready for a passing full-suite/typecheck gate.

The eventual PR targets main only after runner/discovery prerequisites land. CV upload, cleanup scheduling, start/retry background wiring, migrations, private settings, complete screens and live acceptance remain separate integration work. No feature flag was enabled and no live behavior is claimed.

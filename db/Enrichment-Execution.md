# Start/retry execution plan and handoff

Scope: connect existing confirmed jobs to the internal runner from authenticated real start/retry requests. Existing contract, four-source permissions and explicit approval remain unchanged. No live calls, migration, credentials, environment settings, feature enablement or PR creation are authorized by this implementation.

## Plan

- [x] Write failing tests for owner-bound GitHub context and deferred scheduling; implement a small execution module using the current encrypted cookie session and numeric auth identity, never client credentials.
- [x] Write failing start/retry tests; save with the current profile text version, retain manual continuation and queue only executable jobs through Next after(). Leave completed jobs alone and preserve lease/idempotency guards.
- [x] Add real-route/recorded-state coverage and compatible duration configuration for start/retry; critically review, fix findings and run both test rounds.
- [x] Document complete local checks and outstanding deployment prerequisites; prepare READY FOR REVIEW without activating imports or opening a PR.

## Coordination and rulings

Discovery API/configuration, CV upload and cleanup each belong to another active session. This branch touches only execution, start/retry service functions/tests and start/retry route configuration. No shared real.ts/config/environment-template edits are needed here. The discovery session's central OpenAlex field must be `openAlexApiKey`; an optional structural view of central configuration allows this dependency to merge later without reading environment variables elsewhere. Missing research configuration still fails that source honestly through the existing runner.

The configured route duration will be 90 seconds, matching the lease ceiling; collection already has provider deadlines and synthesis has a 20-second SDK timeout. after() is request-scoped best effort, not a durable queue: interrupted work becomes stalled and needs an explicit retry. The deployment must support that duration before enablement. No new scheduler/queue dependency. Ruling: Next's installed runtime guide forbids an explicit runtime export with this app's cacheComponents setting; retain default Node.js and export maxDuration only.

GitHub credentials are captured only when the queued work still needs that source. The cookie's owner must match the authenticated caller. The numeric GitHub subject is looked up under that owner; its token remains only in the deferred callback context. The provider independently checks the token's numeric identity before importing data. A connected GitHub with a missing token yields reconnect for that source, allowing other sources to complete.

Review focus: neither missing/foreign cookie credentials nor a repeated request may create cross-owner work; queued duplicates must retain claim fencing; repeated start must preserve its original base text version; response DTOs/logs/storage must not contain tokens; manual/done jobs must not schedule; current profile revisions must flow through retry; Next runtime limits must be explicit. Existing recorded SQL tests do not prove live concurrency or deployment behavior.

## Implemented behavior

`startEnrichment` reads the saved text revision and performs an owner-scoped read-only idempotency lookup. Completed replays do not read credentials. New GitHub jobs require the owner's linked numeric account, rather than trusting a stored handle. A connected identity with no cookie token reaches the existing provider's reconnect outcome, so unrelated sources can still produce a partial draft. Manual continuation remains available.

`retryEnrichment` refreshes the saved text revision and captures GitHub context only if the source still needs collection. Successful sources remain collected. Both operations call the existing runner through `after()` and return only the documented public job DTO; the background result still needs explicit approval before profile publication.

Each queue attempt has a private UUID. Atomic preparation returns the exact job/attempt pair, and claim verifies that UUID with state/lease/generation checks. An old duplicate callback therefore cannot claim a newer retry using old credentials. Original starts preserve their initial text revision; explicit retries use the latest one. Existing `createJob`/`retryJob` return shapes remain unchanged through thin wrappers. The new private field is optional for already-stored documents; no SQL schema change or migration is needed.

`loadGitHubConnection` reads the encrypted cookie through the existing bearer-stripping helper, requires its owner to match the authenticated caller, and selects that owner's GitHub numeric subject. The provider separately verifies the token belongs to that subject. No credentials come from request JSON, stored jobs, response DTOs or diagnostic messages. The callback captures configuration and credentials before the response; it does not look up a new session later.

## Review findings and fixes

The independent reviewer found that ordinary lease fencing alone allowed an old delayed callback to consume a newer queued retry. A regression reproduced partial instead of queued state; per-attempt fencing fixed it. The reviewer also found unnecessary cookie reads on completed idempotent replays; an owner-scoped lookup and regression fixed that. The reviewer re-read both fixes and found no remaining concrete blockers. Initial full-suite checking also found a foundation test that still expected every real import to return 501; it now tests real dispatch, with actual internal execution covered separately.

## Complete local checklist (no accounts or external services)

1. Fetch the branch in an isolated worktree with its own physical node_modules directory, using the pinned dependencies and supported Node version. Never remove another checkout's dependencies through a junction. No .env.local, database, server or provider key is needed for these mocked tests.
2. Run `npx vitest run src/server/profile/enrichment/execution.test.ts src/server/profile/enrichment/service.test.ts`. Expected: cookie-owner checks, numeric connection lookup, safe deferred context, manual/terminal guards, current text revisions and selected-source scheduling pass.
3. Run `npx vitest run src/app/api/profile-enrichment/execution.test.ts src/app/api/profile-enrichment/staging.test.ts src/app/api/profile-enrichment/route.test.ts`. Expected: actual state/service/scheduler/runner transitions run with isolated persistence and recorded provider replies. Pasted text completes without network access; duplicate callbacks do not duplicate imports; partial/reconnect retry succeeds; a delayed old callback cannot claim a retry; cancellation and auth/origin/flag checks work. Tokens appear only in recorded outbound authorization headers and callback context, never jobs/responses. The existing staging tests retain recorded SQL boundary coverage.
4. Run `npx vitest run src/server/profile/enrichment/storage.test.ts src/server/profile/enrichment/state.test.ts src/server/profile/enrichment/state-concurrency.test.ts src/server/profile/enrichment/runner.test.ts`. Expected: read-only owner lookup, bounded state changes, lease/retry behavior, partial collection, cancellation and privacy regressions pass.
5. Run `npm run lint`, `npm run typecheck`, then `npm test -- --coverage --maxWorkers=4`. Review findings and repeat the checks after fixes. Coverage may print existing binary/HTML fixture parse warnings; no gate was changed to suppress them.
6. Cleanup: no external data, server or account was created. Remove only your own optional test logs; stop no other session's server. Leave the feature flag, credentials, Vercel and database untouched.

## Remaining acceptance and coordination

Keep the feature disabled. This branch changes the credential/consent-sensitive execution path, so the other person's approval is required under AGENTS.md before merge. No PR has been opened by this implementation.

Merge the discovery API/configuration, CV upload and scheduled cleanup tracks before complete acceptance. Discovery's central `openAlexApiKey` field supplies the research runner; no environment values are read or added by this branch. Deployment must honor the configured 90-second duration. These tests do not prove Vercel after() execution, real OAuth/model/provider behavior, live PostgreSQL concurrency or operational cleanup capacity. The full live two-account/source/approval/removal checklist still requires explicit authorization after integration.

## Final verification

After fixing the first review findings, both full verification rounds passed lint, typecheck and 1,149 tests in 78 files, with 98.45% line coverage. The out-of-order callback regression was observed failing before the fix and passing afterward. The independent reviewer rechecked the fixes and reported no remaining blockers in this scope. No screens, SQL schema, dependencies or environment settings changed; browser/build/live tests and migrations were not run. Existing V8 coverage warnings for binary/HTML fixtures remain; checks still exit successfully and no gate was altered.

Shared-file handoff: state.ts changes only job preparation/retry/claim and an owner-scoped idempotency lookup; CV/discovery functions remain unchanged. storage.ts adds only a read-only owner lookup. model.ts adds optional private dispatchToken; runner.ts passes it to claim. real.ts, central config and .env.example remain untouched, leaving the other three sessions' entries/settings available for their implementations. This branch depends on b/enrichment-runner; the eventual PR targets main after prerequisites land.

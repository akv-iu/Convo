# Job for the other Codex window: offline enrichment lifecycle tests

Goal: independently verify the connected internal backend before request wiring and live acceptance. Add only missing tests that cross module boundaries; do not duplicate existing unit tests or change implementation files while other sessions are working.

## Starting point and coordination

- Branch: `b/enrichment-lifecycle-tests`, in a new worktree. Fetch current main and create the branch from main, then merge `origin/b/enrichment-runner` as its development prerequisite. The reviewed starting implementation is `acd8cb9`. Preserve the published prerequisite commits; do not cherry-pick their migrations or manually rename snapshots.
- Do not open a PR until the prerequisite PRs land and this branch is synchronized with main. The eventual PR targets main, never another feature branch.
- Own only new `src/server/profile/enrichment/lifecycle*.test.ts` files and `db/Enrichment-Lifecycle-Review.md`. Do not edit existing tests, gates, contracts, runtime code, configuration, dependencies, migrations or another session's worktree.
- Codex's primary window owns start/retry scheduling and credential capture. Claude owns CV upload integration and scheduled cleanup; discovery is a separate existing assignment. This job does not implement any of those.

## Read first

Read `AGENTS.md`, `docs/Quality-Gates.md`, `docs/features/profile-enrichment.md`, `db/Profile-Enrichment-Contract.md`, `db/Enrichment-State.md`, `db/Enrichment-Approval.md` and `db/Enrichment-Runner.md`. Then inspect state, runner, synthesis, approval, profile synchronization and their existing tests. Earlier integration notes describe earlier phases; use the code and runner handoff for what is implemented now.

## Work

1. Map existing coverage before adding tests. Identify where a unit test replaces a connected internal service with a mock and therefore cannot establish the full lifecycle.
2. Exercise real job-state, runner and approval logic together where practical. Mock only external provider/SDK responses and persistence boundaries; reuse the existing state schemas and fixtures. Keep database version/copy semantics realistic enough to detect stale writes. Do not build a second fake application or reinterpret production SQL in a test helper.
3. Cover the following missing lifecycle cases with a small focused set of tests:
   - Confirmed source selections produce an owner-only draft; collection and synthesis do not publish or index it automatically.
   - Approval saves only the selected evidence and edited bio/expertise. CV evidence is excluded when the acceptance request does not select it. Temporary input is removed after approval.
   - A committed approval whose search synchronization fails returns pending; identical acceptance retries synchronization without a second profile revision.
   - One failed source leaves a usable partial draft. Retry retains successful collection, and old draft versions cannot overwrite newer work.
   - Cancel or supersede during collection/synthesis prevents the late worker from restoring a draft or changing the public profile. Existing SQL tests, rather than an invented in-memory SQL engine, cover atomic cache fencing.
   - Another owner cannot read, accept or withdraw this owner's job/evidence, including reused identifiers.
   - Withdrawing an accepted source removes its approved evidence and preserves unrelated approved sources and user choices; subsequent synchronization uses the updated revision.
4. Independently inspect the runtime path for correctness and privacy. Record concrete findings with file/line, reproduction and impact. Do not fix runtime files concurrently: report findings to the primary window. Distinguish a confirmed defect from an intentionally unwired route or an unverified live-service property.

If an existing integration test already proves a case, cite it rather than adding a duplicate. If a case cannot be tested honestly without a runtime change, explain the limitation instead of substituting a mocked success.

## Verification and handoff

- No live network tests, OAuth sign-ins, migrations, database resets, environment changes, Vercel changes or provider credits. Use fixtures and mocks; no secrets are needed.
- Run the new tests, critically review them, fix findings, then rerun and check regressions. For your test-code changes run lint, typecheck and the unit suite with coverage. No browser suite is required for this backend-only job.
- Document which boundaries were mocked, what the tests actually prove and which database/worker/deployment guarantees remain unverified. Supply the complete local checklist with setup, expected results and cleanup at once.
- Commit and push your own branch. Report **READY FOR REVIEW**, branch/commit, commands/results, findings and remaining blockers. Do not create a PR or merge without the user's approval. A clean test run is not final feature sign-off.

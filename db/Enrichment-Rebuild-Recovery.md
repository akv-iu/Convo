# Recovering approved profiles after a search rebuild

READY FOR REVIEW: `b/enrichment-rebuild-fix`, based on `4799d02` (approved storage `1380e70` plus B1 compatibility `1978923`). No contract, dependency, migration or environment changes. This is Codex's completed version of the seed fix, superseding the parallel seed work on `b/enrichment-rebuild-recovery` (`a7029ae` when checked); merge only one version. Claude's worktree was left unchanged.

`seedUsers()` reads full onboarded user rows and calls the existing `syncProfile(user, elasticSearch)`. It restores approved evidence from all four sources, expertise and the saved revision. Null general evidence uses the current legacy GitHub snapshot; an explicit empty snapshot stays empty. Private job/CV input is never read. Pending flags are acknowledged only at the indexed revision.

A failed user now contributes only their ID to `{ indexed, failed }`; later users still run with the existing eight-worker limit. The CLI reports successful count and failed count/IDs, then registers open asks and refreshes the indices. It throws after those steps if users failed, and the CLI exits non-zero. Provider error bodies, credentials and profile text are not logged. Synthetic ingestion remains fail-fast; database listing, ask or refresh failures still fail the run. Valid rows are not reported as failed merely because another row is invalid.

## Verification and review

The failure was reproduced before implementation: the old function rejected on the first bad user. Regression tests cover more users than one worker batch, rejected Error/non-Error values, successful and database-free runs, asks/refresh before failure, and accurate sanitized counts. Claude's drafted recovery test was reused and extended, without changing that session's worktree. It runs real profile synchronization and Elasticsearch ingestion against recorded Neon rows and a mocked Elasticsearch client: all-source recovery, null GitHub handles, legacy fallback, explicit-empty withdrawal, private-input isolation, indexing failure, corrupt evidence and stale revisions.

Independent review found no concrete correctness/security blockers. No live database, Elasticsearch, provider or index rebuild was contacted. Browser tests are not required for these script changes; full feature acceptance remains open.

Final verification: lint and typecheck pass in both rounds; both full coverage runs pass 1,011 tests in 69 files with 98.54% line coverage. These counts exclude the separate CV parser/dependency branch, which is not part of this fix.

## Complete manual checklist

1. **Local regression, no credentials:** from this branch run `npm run lint`, `npm run typecheck`, and `npx vitest run scripts/seed.test.ts scripts/seed-recovery.test.ts --maxWorkers=2`. Expected: all checks pass. These tests exercise invalid rows and failed indexing without corrupting real attendee records. No server or cleanup is required.
2. **Live setup, only after approval:** use the integrated, reviewed checkout and the final applied migration chain including 0010. Choose a dedicated test Elasticsearch cluster and the intended test database privately. `seed` always uses real Elasticsearch even when the app uses fakes. Keep production enrichment disabled. Do not reset a shared cluster; every deployment using it would lose search data until reseeding finishes.
3. **Reseed:** after the authorized rebuild, or on existing test indices for an idempotency check, run the following from the integrated checkout. Existing shell variables override the env file; confirm the targets privately before execution.

   ```powershell
   node --env-file="D:\Projects\Convo\.env.local" .\node_modules\tsx\dist\cli.mjs scripts/seed.ts
   $LASTEXITCODE
   ```

   Expected: fixture/synthetic/user and open-ask counts, final refresh, exit 0 when all phases succeed. A per-user failure prints only its count/IDs; other users and asks still recover, then exit is non-zero. Do not interpret the successful-user count as the total attempted count.
4. **Inspect results:** using dedicated test accounts whose approved evidence already exists, verify each source, expertise and revision survived. Google-only users have no GitHub handle. Withdrawn evidence must remain absent after a second seed. Source-specific live acceptance needs the runner and approved test profiles; this script fix does not create them. Do not write corrupt snapshots into shared tables to reproduce the automated failure test.
5. **Recover a failure:** inspect the named test account through owner-only profile/source APIs; do not paste private database documents. Restore the test search connection or correct the source through normal confirmed import/approval, then rerun. Expected: the user recovers, a same-revision pending flag clears, and newer indexed revisions remain intact. No fallback resurrects an invalid or withdrawn snapshot.
6. **Cleanup:** restore temporary test settings, keep production's feature flag disabled, and leave migration history and shared indices intact. The local regression creates no accounts, asks, requests or bookings. No live cleanup was necessary in this implementation.

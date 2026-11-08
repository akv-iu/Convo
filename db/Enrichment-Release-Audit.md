# Enrichment migration and configuration audit

Read-only review on `b/enrichment-release-audit`; no formal approval. Only this memo was authored. No lint, build, test suite, migration, secret inspection, provider/account call or deployment was performed. Git fetches and static comparisons only; existing local build artifacts were read without executing them.

## Exact published commits reviewed

| Reference | Commit |
| --- | --- |
| Main baseline | `576692d6be9df20666029db7d89949a02d8df8d4` |
| Execution / assignment | `eb5e4fa3bab120260205a04bcd5ea62472b47de1` |
| CV upload | `13d80c90ff7d6fc576eff930e1051c3bd1566121` |
| Discovery API | `20c7669acd859b3a0f14cfbe298bc9093b1854cb` |
| Cleanup | `2cd44af43a88853b24c2ecf9bcd78afdd0fc3dc4` |
| Published backend integration checkpoint, rechecked | `3bb5d611de3139e2d7a5c969a3dda40cd6d43b9f` |

The four source heads were inspected first. The backend checkpoint was then incorporated into this audit worktree and rechecked. References below use checkpoint line numbers; subsequent fixes require reinspection. Read AGENTS.md and the migration, integration, approval, execution, discovery/API, cleanup and CV handoffs. Earlier handoff statements are historical, not proof of combined acceptance.

## Checks that hold at the checkpoint

- Main's seven existing migration SQL files and seven snapshots are byte-identical on all four source heads and the checkpoint. The journal's existing seven entries are unchanged. Entries 0000–0010 are consecutive, timestamps increase, SQL/snapshot files exist, and each snapshot links to its predecessor without a gap.
- All four source branches and the checkpoint have the same migration tree. The final schema is unchanged from execution. Its eight tables' columns agree with snapshot 0010; new SQL types, defaults, nullability, foreign keys and indexes agree with the schema/snapshots by inspection. The extra `profile` cache kind is a TypeScript text restriction, not a missing SQL enum migration.
- 0007 preserves users, relaxes handle nullability, and backfills immutable numeric GitHub subjects from `github:<number>` IDs. 0008/0009 add linking/private-state tables. 0010 adds columns only: null `profile_evidence` preserves legacy fallback; an approved empty array remains authoritative. No eager evidence copy or existing migration rewrite was found.
- The integrated config and template retain `OPENALEX_API_KEY` → `openAlexApiKey`, `BRAVE_SEARCH_API_KEY` → `braveSearchApiKey`, and `CRON_SECRET` → `cronSecret`. Real discovery supplies both provider keys; execution captures OpenAlex config; cleanup reads the central secret. No public-prefixed fallback. Auth, database, Elastic and OpenAI template names match their existing consumers. The feature template remains off. Start/retry declare 90 seconds; cleanup declares 60 seconds with a 30-second batch-start budget, not a hard per-query timeout.

## Actionable findings for Claude 1

1. **Block activation: empty-result manual jobs retain input and can starve cleanup.** `src/server/profile/enrichment/state.ts:299`, `state.ts:10`, `src/server/profile/enrichment/storage.ts:31`. An active import finishing without evidence becomes terminal `manual` while retaining `input`; expiry skips it. The unchanged document leaves `next_sweep_at` in the past, so repeated oldest-owner batches can exclude other owners. **Required fix:** erase input/collected private content on manual completion and repair stale scheduling metadata even on unchanged documents, with the planned retention/starvation regressions. Already reported by cleanup; still present in this checkpoint.

2. **Block an unqualified 48-hour deletion promise.** `vercel.json:4`, `db/Enrichment-Cleanup.md:72`, `src/app/api/cron/enrichment-cleanup/route.ts:18`. A daily cron with scheduling spread permits approximately 49 hours from staging to physical deletion even on successful runs; failures/budget exhaustion can extend this further. The batch budget does not establish a retention guarantee under slow storage. **Required fix:** document the user's actual plan/schedule decision, align all retention claims with it, and specify monitoring/recovery for partial/failed runs. If the 48-hour target is retained, publish a compatible supported schedule and verification evidence. Do not enable a paid service or change the promise implicitly.

3. **Fix the deployment instructions' ordering.** `db/Enrichment-Cleanup.md:102` lists merge/redeploy before migration application at line 104. New ordinary profile reads require 0010 columns even with enrichment off, and cron requires 0009. **Required fix:** put reviewed migration application and verification before deploying the code that selects those columns; retire old evidence writers before enabling imports. Preserve the feature-off and backup/history checks in the migration handoff.

4. **Resolve the known runner fixture before presenting combined checks as green.** `src/server/profile/enrichment/runner.test.ts:19`. It still calls `recordDiscovery` without saved identity/reserved generation. The discovery author reported the resulting unit/typecheck failures. **Required fix:** stage the identity, reserve discovery, pass that generation, and publish Claude 1's combined check results at a new exact commit. Individual source-branch results are not combined acceptance. No checks were rerun for this audit.

## Author results and actual packaging evidence

Reported source checks: execution 1,149 tests / 98.45% lines; CV upload 1,140 tests; cleanup 1,133 tests / 98.4% lines, each with lint/types passing. Discovery API reported 1,152 passing plus the one runner failure, 98.22% lines, and the corresponding typecheck failure. These results predate the combined checkpoint; no combined success is claimed here.

CV packaging is more than a source-code assertion: the CV author's existing `.next/BUILD_ID` and `server/app/api/profile-enrichment/cv/route.js.nft.json` exist. Every inspected referenced worker/parser artifact exists. The trace includes a worker-thread chunk and unpdf chunk; a referenced root chunk contains Mammoth. SHA-256 evidence:

- CV route trace: `fe4b6e765201709a9f212b865c9e2bd2ae333befab1a4816d7349657a552686c`.
- Worker chunk: `165ef04b3d6492c8b34906b4761486705d74b1511c9ff3d0d8027684b30a7279`.
- unpdf chunk: `24333f4709e762363787248c4f1af01196a12f94365c359a7e69701e1793c7b5`.
- Mammoth-containing root chunk: `57a5cf534190d3774f84f2940815700cb79c0d2483cdaee13a341be98b456d9c`.

These local, uncommitted artifacts support the CV author's build report; they are not an attestation of the final integration build/environment. Claude 1 must publish the final credential-free build result and route trace check. Supported parser runtime is Node 22.18+ on the 22 line or Node 24; the package engine's broader lower bound alone does not prove other majors work.

## Eventual setup/apply/verification — NOT EXECUTED

1. Resolve the findings; review Claude 1's final commit/results and final worker traces. Confirm the intended runtime supports start/retry's 90 seconds and cleanup's 60 seconds, and record the actual hosting plan/retention decision. Keep `PROFILE_ENRICHMENT_ENABLED=0`.
2. Privately verify the intended database and backup, its actual applied migration history, and whether any provisional enrichment migrations were ever applied. Stop and reconcile if history differs; never rename/reset applied migrations. Review every outstanding SQL file, not only 0007–0010.
3. After explicit authorization, apply from the reviewed final checkout using the intended private environment: `node --env-file=<private-target-env-file> ./node_modules/drizzle-kit/bin.cjs migrate`. An existing shell `DATABASE_URL` overrides that file. Do not display secrets. Apply before deploying consumers of the new columns; do not treat the command as currently authorized.
4. Privately verify new tables/foreign keys/indexes, nullable `github_login`, the five 0010 columns, the migration ledger, and zero missing backfilled identities using the read-only queries in `db/Enrichment-Migrations.md:36`. Confirm existing users/asks/requests/avatars are preserved. A second authorized migration invocation should apply nothing new.
5. Person B supplies the existing auth/database/Elastic/OpenAI settings and private OpenAlex/Brave keys as needed; set a random, header-safe `CRON_SECRET` for Production and redeploy. Keep keys out of public variables, URLs and logs. Confirm cron registration and the selected schedule. No settings were read or changed here.
6. After separate live-test authorization, verify one real PDF and DOCX on Preview, real start/retry completion, independent discovery sources, approval/withdrawal and rebuild recovery, and cleanup before/after expiry with counts-only output/cache erasure. Check failed/partial cron recovery and absence of private content in diagnostics. Leave the flag off until full feature acceptance and required approvals.

Unverified: actual database history/application/backfill data, deployment plan/duration enforcement, final integrated build packaging, Vercel worker/after()/cron behavior, credentials/account entitlements and provider terms, live concurrency, cleanup capacity and physical deletion timing. No PR, main merge, deployment or formal approval is supplied by this memo.

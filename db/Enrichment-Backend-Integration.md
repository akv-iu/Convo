# Backend integration: profile enrichment

Branch `b/enrichment-backend-integration`, from `origin/main` `576692d`. It merges four published tracks, in this order:

| Track | Branch | Commit |
| --- | --- | --- |
| Execution | `b/enrichment-execution` | `eb5e4fa` (implementation `b0c2655`) |
| CV upload | `b/enrichment-cv-upload` | `13d80c9` |
| Discovery API | `b/enrichment-discovery-api` | `20c7669` |
| Cleanup | `b/enrichment-cleanup` | `2cd44af` |

Their prerequisites arrive with them; nothing was cherry-picked again. That includes the foundation and contract, auth, durable state, research, the GitHub collector, the public-profile provider, the CV parser and its pinned dependencies, approved evidence, B1 search and rebuild recovery, the runner and discovery. The source branches are unchanged.

## Integration fixes

1. **`state.ts` conflict (execution + CV upload).** Only the imports conflicted. Both are kept: execution's `readOwner`, and the CV parser.
   - CV staging keeps its safeguards: the upload rate limit counts before parsing, only extracted text is kept, and the pending CV is replaced only after the new one has been read.
   - Execution keeps its per-attempt `dispatchToken`, checked in `claimJob`.
   - They don't interfere: CV replacement discards old queued jobs, whose workers `claimJob` then refuses.
2. **`config.ts` and `.env.example` (discovery + cleanup).** Both sides are kept: `openAlexApiKey`, `braveSearchApiKey` and `cronSecret` in config, and `OPENALEX_API_KEY`, `BRAVE_SEARCH_API_KEY` and `CRON_SECRET` in the template.
3. **Runner fixture.** It now saves the identity, reserves discovery, and passes the returned generation to `recordDiscovery`, as the real discovery API does.
4. **Manual jobs kept private input.** An all-empty run finished `manual` but kept `job.input`, which can hold pasted page text, until its 48-hour history ended. `finishDraft` now clears input and collected excerpts on `manual`; manual jobs are never retried.
5. **Stale cleanup deadlines starved other owners.** `mutateOwner` skipped every write for an unchanged document, so a past `next_sweep_at` was selected first by every cleanup batch. It now rewrites the deadline, version-guarded, whenever the stored value differs from the computed one. A correctly scheduled, unchanged row is still not written.
6. **Referee headings.** "Referees (available on request)" and similar headings didn't end a CV section, so a referee's name could reach synthesis. They now end it.
7. **Execution config.** It now reads the OpenAlex key directly from config; a temporary typed shim is removed.
8. **A late CV upload could restore input after newer choices** (boundary audit 1). An upload counted its attempt, then parsed, then staged its text with no check. So a slow parse finishing after page 2 continued with CV off, or after a newer upload, could put old CV text back or cancel work on the newer CV.
   - Now the attempt reserves an owner-private `cvAttempt` (`uploadId` plus the consent generation) before parsing. The final write stages the text only if that attempt is still the current one and the generation hasn't changed; otherwise it answers 409 `consent_changed` and keeps nothing.
   - A start, identity change or withdrawal bumps the generation. A newer upload replaces the attempt.
   - `cvAttempt` is optional in the stored document, so existing rows still parse.
9. **Manual jobs stored before fix 4 still held input** (fix-verification follow-up). `expire()` treats `manual` as finished, so those rows kept their input and a past cleanup deadline. `expire()` now clears input, collected excerpts and cache keys from any manual job; job history and the owner's pending CV are kept.

Items 4–6, 8 and 9 have failing-first regressions:
- `state.test.ts`, including a stored manual row with input, cleaned alongside another owner;
- `storage.test.ts`;
- the cleanup route test;
- `professional-text.test.ts`;
- `cv-staging.test.ts`: a held parser finishing after a CV-off start, and after a newer upload, including work started on the newer CV.

`state-concurrency.test.ts`'s two-uploads race now allows the older upload to be refused, and checks that only one CV's text remains.

## What was verified

| Check | Result |
| --- | --- |
| Real dispatch | `real.ts` sends discovery to `discoverEnrichment` with the configured keys, upload to `stageCvText` (pasted text or a PDF/DOCX through the isolated parser), and start/retry to `startEnrichment`/`retryEnrichment`, which schedule `runEnrichment` through `after()` with a per-attempt token (`maxDuration` 90). |
| Feature gating | Enrichment routes return 404 `feature_disabled` while `PROFILE_ENRICHMENT_ENABLED` is off. The cleanup route doesn't check the flag, so it runs either way. |
| Migrations | `0000`–`0006` are byte-identical to main. The journal only appends `0007`–`0010`. Each snapshot's `prevId` links back to main's `0006`. `drizzle-kit check` reports "Everything's fine", and `drizzle-kit generate` reports "No schema changes". `0007`'s numeric-ID backfill is intact. Nothing was applied to any database. |
| Production build | `next build` succeeds with an explicitly fake, credential-free environment (`FAKE_API=1`, no `.env` files, no keys). Turbopack emits the CV worker as a `[worker thread]` chunk. Through `next start`, a temporary, uncommitted route that called the parser returned the expected result for 11 real fixtures: text, truncation, encrypted, scanned, expansion and miscount, heap, memory and unsupported. The server log held no document text. `/api/cron/enrichment-cleanup` built as dynamic and answered 503 `not_configured` with no secret. No provider was contacted. |
| Final run at `411e086` | Lint and typecheck clean; 1,230 unit tests in 84 files pass with 98.51% line coverage; `drizzle-kit check` reports "Everything's fine". |
| Final run after fixes 8–9 | See "Final checkpoint" at the end of this file. The build and migration checks above are reused: fixes 8–9 change only the private JSON document and state logic, not the database schema or the worker's packaging. |

## Still open

**Deployment blockers (each needs your approval):**
1. **Apply migrations `0007`–`0010` before deploying this code**, even with the feature off. Ordinary profile reads select the new user columns, so production must not run this code before the migrations. Follow the order in `Enrichment-Migrations.md`; never reset data.
2. **Vercel settings (Person B):**
   - `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`;
   - `OPENALEX_API_KEY` and `BRAVE_SEARCH_API_KEY`;
   - `CRON_SECRET`, in Production only;
   - the Node runtime set to 22.18 or newer (`package.json` engines);
   - `PROFILE_ENRICHMENT_ENABLED` left off until acceptance passes.
3. **Retention decision.** On a daily cron, which is all Hobby allows, physical deletion of expired input takes up to about 49 hours from staging, against the proposed 48. A failed or partial run adds a day. Input is unreadable after 24 hours either way. The options, plus monitoring and recovery steps, are in `Enrichment-Cleanup.md`: accept about 49 hours and say "about two days", move to Pro with an hourly schedule, or add a second free trigger, which is a gated `.github/` change. Until you choose, nothing should promise deletion "within 48 hours".
4. **Retire old evidence writers** (older deployments still writing evidence the previous way) before enabling imports.

**Not verified live:**
- Google and GitHub OAuth;
- OpenAlex, Brave and page fetches;
- the OpenAI call, including whether strict structured output accepts the generated schema's length limits and `$schema`;
- PostgreSQL row locking;
- `after()` running within the route duration on Vercel;
- the cron invocation itself.

**Known limitations and open findings (not fixed here; each needs an owner's decision):**
- `after()` is not a durable queue. An interrupted import becomes `stalled` after its lease and needs an explicit retry.
- **Synthesis validation rejects whole proposals.** If any expertise label or sentence trips the contact/sensitive filter or mentions the workplace or country, the import fails as `provider_down`. Examples: "Mobile robotics", "Contact centre analytics", "Mentored 4 engineers to drive …". A label-level drop, or a manual draft that keeps the evidence, would be kinder.
- **The input filter errs toward privacy.** It drops lines starting "Mobile", "Contact", "Gender" or "Address"; lines with a number followed by "drive", "lane", "st" or "rd"; and digit runs such as ISO dates and DOIs. Professional evidence can silently go missing.
- Sonar flags `professional-text.ts` line 6 (the email pattern) as possibly super-linear. It predates this branch.

## Complete checklist

**Setup (no credentials):**
1. Create a worktree of this branch with its own `node_modules` (not a link to another checkout). Use Node 22.18+ or 24, and run `npm ci`.
2. Leave `.env.local` absent for these checks.

**Automated checks:**

3. Run `npm run lint`, `npm run typecheck`, then `npx vitest run --coverage --maxWorkers=2`. Expected: all pass. Coverage prints harmless parse warnings for binary CV fixtures.
4. Run `npx drizzle-kit check`, then `npx drizzle-kit generate`. Expected: "Everything's fine", then "No schema changes"; `git status` stays clean.
5. Focused runs, each expected to pass:
   - `npx vitest run src/app/api/cron` (cleanup, 16 tests);
   - `npx vitest run src/server/profile/enrichment` (state, storage, runner, execution, discovery, CV and synthesis);
   - `npx vitest run src/app/api/profile-enrichment` (route dispatch, upload, discovery and execution).
6. Credential-free build: from a shell with no provider variables, run `FAKE_API=1 PROFILE_ENRICHMENT_ENABLED=0 npx next build`. Expected: success, and `.next/server/chunks/` contains a `[worker thread]-…cv-worker…` chunk. Delete `.next` afterwards.

**Local HTTP checks (fake API, no database):**

7. Start `npm run dev` on a free port with `FAKE_API=1` and `PROFILE_ENRICHMENT_ENABLED=1`. Follow the API-only checklist in `Profile-Enrichment-Contract.md` (fake fixtures).
8. On the same server, without `CRON_SECRET`: `curl.exe -i http://localhost:<port>/api/cron/enrichment-cleanup` returns 503 `not_configured`. Restart with a throwaway `CRON_SECRET`: a wrong header returns 401, and the right header returns 503 `failed`, because there's no database. Stop the server.

**Live acceptance (unrun; needs your authorization):**

9. Apply the migrations to a dedicated test database (see blocker 1), set the test settings privately, and deploy a Preview with the feature on for test accounts only.
10. Run the two-account checklists, in this order:
    - `Enrichment-Approval.md` steps 1–9;
    - discovery in `Enrichment-Discovery-API.md`;
    - CV upload in `Enrichment-CV.md`;
    - execution start, retry and cancel in `Enrichment-Execution.md`;
    - cleanup steps 4–6 in `Enrichment-Cleanup.md`.

    Expected:
    - a Google-only and a GitHub account can each confirm all four sources;
    - CV excerpts start unselected;
    - approval publishes only the chosen evidence;
    - withdrawal removes only that source;
    - another account's IDs return 404;
    - nothing private appears in logs or other users' cards.

**Cleanup:**

11. Stop local servers, delete `.next`, and discard throwaway secrets. Keep production's feature flag off. Leave migration history and shared data as they are. Remove test accounts' staged input through the owner APIs, not with SQL.

## Proposed PR order (all target `main`; none opened)

1. **This backend integration.** It needs the other person's approval, because it changes sign-in, consent and visibility (AGENTS.md rule 4) and needs new settings. Merge only once blocker 1 (migrations) is ready to apply right before the production deploy.
2. **The frontend flow integration** (`b/enrichment-flow-integration`, Claude 2), rebased on `main` after PR 1. It completes the feature file, so it needs approval after a Preview try.
3. **Settings, Preview live acceptance and the retention decision.** Then switch `PROFILE_ENRICHMENT_ENABLED` on, only with your approval.

## Final checkpoint

The last code commit is the one that contains this section; the report gives its hash.

| Finding (source) | Status | Regression |
| --- | --- | --- |
| Late CV upload after consent change or newer upload (boundary 1) | Fixed (item 8) | `cv-staging.test.ts`: CV-off start during a held parse; an older upload finishing after a newer one, before and after work starts on the newer CV |
| Manual jobs keeping private input (boundary 3 / release 1) | Fixed for new completions (item 4) and stored rows (item 9) | `state.test.ts`: all-empty completion; stored manual row with input cleaned alongside another owner |
| Stale cleanup deadlines and starvation | Fixed (items 5 and 9) | `storage.test.ts`: stale vs correct deadline; the cleanup route's starvation test; the stored-manual-row test above checks the deadline moves into the future |
| Runner discovery fixture (release 4) | Fixed (item 3), confirmed by fix verification | `runner.test.ts` |
| Unqualified 48-hour promise (release 2) | Wording aligned; monitoring and recovery documented. **The schedule decision stays open (yours)** | Docs only; a schedule test can't prove deletion timing |
| Deployment before migration (release 3) | Fixed: `Enrichment-Cleanup.md` setup now applies and verifies migrations first, and retires old writers before imports | Docs only |
| Draft edits lost on retry or reload (boundary 2) | Frontend: fixed in `b/enrichment-flow-integration` 8e03503 (Claude 2) | `review.test.ts`, `review.spec.ts` there |

Final run (once, after fixes 8–9): lint and typecheck clean; **1,233 unit tests in 84 files** pass, with 98.52% line coverage (2,791 of 2,833). Reused, unchanged by these fixes: the credential-free `next build` with the worker chunk, and `drizzle-kit check`/`generate`, both recorded above at `411e086`. No live service, secret, migration or deployment was used.

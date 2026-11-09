# Approved evidence and source withdrawal

Implementation plan for b/enrichment-approved-evidence, based on b/enrichment-github 9b143a4. Spec: the approved delivery brief's Evidence, approval and concurrent changes section and the existing enrichment contract. B2 files only; Claude retains public-profile/CV provider files. No live calls, migration application, configuration or PR creation.

## Design

Keep a nullable general evidence snapshot alongside legacy GitHub evidence. Null alone means legacy fallback; an approved empty array is authoritative. Store source metadata/tombstones and optional expertise on users. Separate text_version from the existing search revision. Approval and withdrawal compare both the public user revision and private document version in one row-locked SQL statement, so cancel, source removal and concurrent profile edits cannot partially commit. Search remains a revision-ordered copy, with saved-but-pending responses and identical-approval retries.

## Tasks and proof

- [x] Evidence boundary: write failing tests for all four sources, ownership, namespaces, source/kind limits, explicit-empty snapshots and bad stored data; implement one B2 helper reused by profile sync and approval. Sources have fixed owner/source IDs; removed records are retained as bounded four-source tombstones.
- [x] Schema/profile: generate additive 0010 after the actual 0007-0009 chain; backfill legacy evidence/source metadata lazily on first atomic approval, retaining null fallback during rollout. Add optional expertise, text version and a general pending flag. Profile/availability/sign-in saves preserve complete approved sources; bio edits alone increment text version. Test null versus empty and legacy sign-in preservation.
- [x] Draft/approval: record base text revision, lease-check completed drafts and validate evidence references. Approve selected evidence only, replacing successful source snapshots while preserving unselected/failed sources. Atomically save text/evidence and erase temporary input; identical retries only repair indexing. Test edits, stale versions/consent, expired CV, duplicate/foreign picks and save/index failures.
- [x] Withdrawal: owner-only source list/removal; atomically remove only the selected source from approved evidence, invalidate unaccepted work/private inputs, preserve edited text/unrelated evidence and mark search pending. Repeated removal must not cancel newer work. Update both B2 match pending readers. Test concurrency and failure recovery.
- [x] Review twice and run lint/typecheck/full tests with coverage; check migration chain/no drift and obtain independent final review. Supply one future live/manual checklist and the exact B1 read interface. Push READY FOR REVIEW, with no PR/merge or live application.

## Boundaries

The import runner, discovery route wiring, CV parser, sensitive-data scrubbing and synthesis/cache remain separate tasks. No raw input is approved by this service: it consumes only lease-checked collected professional excerpts. No model call or imported draft is published automatically. New active imports stay not_ready until their runner exists. Existing approved excerpts may be visible to matches; raw CV/pasted input is owner-private and discarded.

## Review focus

An empty general snapshot must not restore withdrawn legacy evidence. A late worker/accept must not win after revocation. Availability/colour edits must not invalidate text, but bio edits must. Index failures after commit must return a recoverable saved version. A legacy sign-in must replace only GitHub evidence and never erase accepted research, public-page or CV evidence.

## Review rulings

- Keep profile_evidence NULL during migration rollout. An eager copy can freeze repos while old deployed sign-in code still changes/revokes legacy consent. The first explicit approval lazily converts the latest legacy snapshot inside the fenced commit; source withdrawal materializes an empty/filtered authoritative snapshot the same way. This satisfies the backfill requirement without rewriting rows during deployment. Retire old application writers before enabling enrichment.
- An identical approval or removed-source retry re-reads the public row after observing its receipt/tombstone. Independent initial reads can straddle an earlier commit; returning the first user read could index/report an older revision.

## Storage handoff for B1

The schema exports `users.profileEvidence` (nullable `ApprovedEvidence[]`), `profileSources`, `profileEvidencePending`, nullable `expertise`, and `textVersion`. Do not read the private `profile_enrichment_states.document` for indexing or rebuilds.

- Query the complete user row with the updated schema. Skip only unfinished users (`filters === null`).
- Call the existing `syncProfile(user, elasticSearch)` from `src/server/profile/service.ts` with the real search instance, irrespective of the app's fake switch. This validates the complete snapshot and sends `person`, **all** approved evidence, and `user.revision` to `ingestPerson`. It acknowledges pending flags only at that same revision. Replays are revision ordered.
- `indexedEvidence(user)` from `src/server/profile/evidence.ts` is available when a caller needs the validated `EvidenceDoc[]` without an index write. `approvedSnapshot(user)` contains source bookkeeping; do not pass that shape straight to B1.
- `profileEvidence === null` means read current legacy GitHub evidence. `[]` means deliberately empty: never use an array-length fallback. An invalid non-null snapshot fails safely rather than restoring old evidence.
- No script changes are included here. B1 owns rebuild integration. Never clear pending flags separately or manufacture a revision. A failed rebuild must leave the database snapshot intact.

For the future runner, start with `createJob(owner, input, githubLogin, currentUser.textVersion)`. Collection still goes through `recordCollection`; synthesis completes through `finishDraft(owner, jobId, leaseToken, { bio, bioEvidenceIds, expertise })`. That function assigns the draft version and base text version and rejects revoked/expired leases. Provider calls must stay outside retryable storage mutations.

## Data and deployment

Migration `0010_approved_profile_evidence` adds five user columns only; it does not drop or copy existing data. Its generated snapshot follows 0007 provider identities, 0008 linking attempts and 0009 private staging. Apply the final reviewed chain **before deploying this code**, even with enrichment off: ordinary profile reads now select these columns. If main's schema changes first, regenerate the later migration/snapshot chain; do not rename snapshots.

After approval, only selected professional excerpts enter public evidence. The temporary CV used by that job, pasted source input and collected draft are erased in the same commit. The receipt stores a hash and revision, not submitted text. Source withdrawal invalidates unaccepted jobs, clears their inputs and removes only that source's public evidence. Hand-edited bio/expertise remain, with `reviewBio: true`; a source withdrawal does not claim to rewrite the user's text. At most four source records/tombstones are retained.

The staging kernel retains job metadata for at most 48 hours and unaccepted inputs for at most 24 hours, subject to its cleanup hook being scheduled. Operational cleanup scheduling and owner-scoped synthesis-cache deletion must ship before enabling imports; no synthesis cache is created by this branch. Retire old deployment writers before enabling enrichment. No migration or live service test has been run by the agent.

## Complete manual checklist (future authorized live check)

Use a dedicated test account/database and the final merged schema, not shared attendee data. Approval cases below need the real collector/synthesis runner; they cannot run on this branch alone. The deterministic fake demonstrates screens but does not verify this Postgres storage implementation. Do not inject draft rows into Neon to bypass the missing runner.

1. **Setup.** Review/apply the final migration chain using [the migration checklist](Enrichment-Migrations.md#setup-and-application-live-user-approval-required), including 0010. Keep production disabled. Verify these five columns without selecting private input:

   ```sql
   SELECT column_name, is_nullable, column_default
   FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'users'
     AND column_name IN ('profile_evidence', 'profile_sources',
                         'profile_evidence_pending', 'expertise', 'text_version');
   ```

   Expected: five columns, nullable evidence/expertise, text version 0 and general pending false by default. Existing badges, avatars, asks and bookings remain. Use the intended private environment; never paste keys or DATABASE_URL.
2. **Start the test server.** Only after live-test authorization, use the integrated checkout with `FAKE_API=0`, `FAKES=search,ai` for local search/AI first, and the feature enabled in the test environment. Sign in manually. In DevTools define this helper; redefine it after a full page reload:

   ```js
   async function enrichmentApi(path, body) {
     const response = await fetch(`/api/profile-enrichment${path}`, {
       method: body === undefined ? 'GET' : 'POST',
       ...(body === undefined ? {} : {
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify(body)
       })
     });
     const result = { status: response.status, body: await response.json() };
     console.log(result); return result;
   }
   ```
3. **Source listing (available before the runner).** `await enrichmentApi('/sources')`. A legacy account with public repos lists its GitHub source; a new Google-only account with no approved evidence lists `[]`. Only owner metadata is returned, not raw CV/job input. Signed-out access returns 401.
4. **Baseline preferences.** Finish country/workplace/hiring, badge, avatar and availability with the test account. Note these choices and the current edited bio. Using the runner, confirm research and CV sources and start the job. While it runs, change badge/availability: approval must still work. Start a second job and edit the saved bio instead: accepting that stale draft must return 409 `text_changed`, retaining the edited bio.
5. **Explicit approval.** Wait for a ready/partial draft on page 5. Confirm CV excerpts begin unselected. Approve only a chosen paper plus edited bio/expertise. Expected: 200 with `sync.status` confirmed (or pending on index failure), a saved revision, chosen evidence only, and unchanged country/workplace/hiring, visibility, avatar, colour and availability. Refresh/re-sign-in: these choices persist. Private pending CV disappears. No CV contact details or pasted input appear in another account's cards or evidence.
6. **Index failure and retry.** On a test deployment only, temporarily make its Elasticsearch endpoint unavailable, with `FAKES=ai` so search is real. Approve a new draft: expected 200/pending, saved evidence retained, and pending users absent from other users' match results. Restore the endpoint. Replay the **identical** accept body against the same job: expected 200/confirmed, no second text/evidence save, and the saved evidence visible in matches. A changed body on that accepted job returns 409 `draft_superseded`. Ordinary profile saves also retry indexing. Do not change production settings for this test.
7. **Withdrawal.** `const savedSources = (await enrichmentApi('/sources')).body;` choose a source from the test account, then `await enrichmentApi('/sources/' + encodeURIComponent(savedSources[0].id) + '/remove', {})`. Expected: 200/removed, `reviewBio: true`; only that source disappears from the list and matched evidence. Edited text and unrelated sources remain. An in-progress import started before removal must not publish later. Refresh, re-sign-in and rebuild search through B1: withdrawn evidence must stay absent. A repeated remove repairs pending sync and must not cancel a newer job. Do not test using a real attendee's source.
8. **Owner isolation and stale choices.** From a second signed-in account, attempt to accept the first account's job or remove its source: 404, no changes. After source choices change or a job is cancelled/superseded, an old accept must conflict; duplicate/foreign evidence picks return 400. Ready drafts with expired CVs cannot be accepted. Expiry/lease races are covered by mocked-time tests; do not alter the shared database clock.
9. **Cleanup.** Cancel remaining unaccepted jobs and remove staged CVs through the owner APIs. Restore test search settings and the disabled feature flag; stop the local server. Do not restore withdrawn evidence by SQL, reset shared tables, delete accounts with bookings or alter migration history. Re-import only through a new confirmed source choice after the runner exists. Review the bio if it still names a removed source.

## Verification

Tests use recorded SQL results, fake timers and mocked search; no Postgres, GitHub, OpenAI, Brave or page requests. Coverage includes guarded writes, a lost-version retry, source removal winning an approval race, a newer receipt than the initial profile read, private-input erasure, CV expiry, stale text/consent, explicit-empty evidence and indexing recovery. Live PostgreSQL concurrency, migration execution and full browser/provider acceptance remain open. This branch does not complete the feature or enable imports.

Final two unit runs: 993/993 tests in 68 files, 98.49% line coverage. Lint, typecheck, migration check and a no-drift generation pass. Independent review found and verified fixes for eager rollout backfill and a stale initial read during receipt retries; no remaining concrete blockers were identified in this scope.

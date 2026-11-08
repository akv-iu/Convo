# Private staging and durable enrichment state

Status: backend layer for review on `b/enrichment-state`, based on the auth branch and revised foundation. Feature remains disabled by default. This is not the collector, AI worker or approval implementation, and no migration/provider/production setting has been applied.

## Implemented

Real handlers now stage page-one answers, return safe owner state, accept/remove **pasted CV text**, and create/read/cancel all-off or skipped-source manual jobs. API response shapes stay unchanged. ORCID is format/checksum-validated; it is only a lookup hint, not authentication or proof of authorship. Selected-source starts and PDF/DOCX parsing deliberately return 501/not_ready before queuing anything. Accept/source withdrawal still await the later approved-evidence layer.

The job kernel persists owner-bound selections, idempotency fingerprints, collected evidence and progress. It can claim a single 90-second lease, detect a stalled worker, retain successful source evidence across deliberate retry, and reject results from a cancelled, superseded or expired lease. Queued jobs also become stalled if no worker claims them within 90 seconds; a deliberate retry starts a fresh claim deadline. New private rows store an optional queuedAt; older rows derive their first deadline from the job's fixed input lifetime. These internal operations have recorded-data tests; no external collector or after() runner is connected yet. No automatic unattended retries are promised.

`profile_enrichment_states` is one private Postgres row per owner, containing a versioned JSON document and cleanup deadline. Optimistic version checks retry a conflicting pure mutation against the latest saved row, so multiple tabs cannot silently replace each other's state. Providers must never run inside a retried mutation. Foreign keys require a saved account; owner IDs come from the authenticated API context. Invalid stored formats fail safely rather than resetting consent/history. The document is never returned wholesale or indexed as a public profile.

Temporary CV text and pasted public-profile job input expire after 24 hours. Cancel, supersede, identity change, CV replacement/removal and confirmation with CV off erase associated private input and unapproved collected material. Requests enforce expiry before reading/claiming; public responses contain only contract metadata/progress. Minimal job/idempotency metadata stays for 48 hours; removed-upload IDs stay for 24 hours for owner-only idempotent deletion. No provider tokens, original document bytes or raw-input logs are introduced.

Erasure here means removal from the current application document. Old Postgres row versions and provider backups/restore history can retain earlier contents until their own reclamation/retention windows; this layer does not promise immediate removal from that history.

Discovery previews are owner/input-bound and capped at 16; pending jobs at 50. Durable ten-minute limits allow 30 identity saves and 6 each of upload/start/retry, with 12 discovery records. Known identical start replays do not consume another start or change its saved state. Completed manual profiles remain distinct from unaccepted generated drafts.

## Remaining before enablement

- The real source collectors, safe page fetching, isolated PDF/DOCX parsing and contact-data scrubbing.
- A bounded after() runner that uses the lease kernel, then cached synthesis and explicit approval with text-version checks.
- General approved-evidence storage/indexing and withdrawal. Collected evidence in this private row is **not** approved searchable evidence.
- Authenticated operational cleanup scheduling. `cleanupExpired()` processes a bounded due batch and erases expired inputs; it has no public endpoint yet. Read/write expiry enforcement works now, but no unattended physical-purge window is promised until scheduling and backlog draining are configured and verified. This blocks production private-input enablement.
- Full flag-on screens and live acceptance with Claude. Neither fake tests nor an internal lease test establishes that the complete user journey works.

Before enabling real imports, settle stored-document upgrades/rollback handling, the runner's time budget or lease renewal, a lease-checked CV accessor and GitHub connection revalidation. Also reconcile the job-history-limit retry hint and shared ORCID checksum validation. These next-phase findings are not implemented by the state-layer review fixes.

## Migration hold

The generated, additive proposal is currently `0007_enrichment_state`: one table and indexes, no public-profile rewrites/drops. It is based on the foundation/auth snapshots. Main now contains #47's `0005_new_ask_defaults` and #50's regenerated `0006_default_avatars` at `d139e82`. Regenerate foundation, auth and this migration against that merged schema/snapshot chain, preserving provider backfills and avatar/default changes. Do not fix collisions by renaming numbers, and do not apply this provisional chain to Neon now. Apply/review the final regenerated migrations only with user authorization.

## Complete manual checklist (future authorized live staging check)

Prerequisites: merged nullable compatibility, foundation, authentication and this layer; regenerated/reviewed migrations applied to the intended test Neon target; Google/GitHub configured per [the auth checklist](Google-GitHub-Auth.md). Use dedicated test accounts and keep production disabled. This checklist uses live authentication/Postgres and fake search/AI, not live collectors or AI. An agent must ask before running it.

~~~powershell
$env:FAKE_API = "0"
$env:FAKES = "search,ai"
$env:PROFILE_ENRICHMENT_ENABLED = "1"
node --env-file="D:\Projects\Convo\.env.local" .\node_modules\next\dist\bin\next dev --port 3000 --webpack
~~~

Sign into the test account; until new screens land, use the built-in `/api/auth/signin?callbackUrl=/signin/sources`. On the local origin paste this whole API checklist into DevTools:

~~~js
async function staging(path, body, method=body===undefined?'GET':'POST', status=200) {
  const form=body instanceof FormData;
  const response=await fetch('/api/profile-enrichment'+path,{
    method,headers:body!==undefined&&!form?{'Content-Type':'application/json'}:{},
    ...(body!==undefined?{body:form?body:JSON.stringify(body)}:{})
  });
  const value=await response.json();
  if(response.status!==status)throw new Error(JSON.stringify({path,status:response.status,value}));
  return value;
}
var original=await staging('');
var answers={name:'Staging test attendee',country:'US',workplaceName:'Test workplace',rorId:null,orcid:'0000-0002-1825-0097'};
await staging('',answers,'PUT');
await staging('',{...answers,orcid:'0000-0002-1825-0098'},'PUT',400);
var form=new FormData();form.set('consent','true');form.set('text','Private professional CV test input');
var upload=await staging('/cv',form);
if('text' in upload||upload.filename!==null)throw new Error('CV response leaked text');
var saved=await staging('');
if(saved.identity.name!==answers.name||saved.pendingCv.uploadId!==upload.uploadId)throw new Error('Staging missing');
var input={identity:answers,idempotencyKey:crypto.randomUUID(),github:{import:false,bio:false,repos:false,orgs:false},research:null,publicProfile:null,cv:null};
var manual=await staging('',input);
if(manual.state!=='manual'||manual.draft!==null)throw new Error('Manual continuation');
if((await staging('',input)).jobId!==manual.jobId)throw new Error('Idempotency');
if((await staging('')).pendingCv!==null)throw new Error('CV-off confirmation retained input');
await staging('/cv/'+upload.uploadId+'/remove',{});
await staging('/cv/'+upload.uploadId+'/remove',{});
await staging('',{...input,idempotencyKey:crypto.randomUUID(),publicProfile:{kind:'text',text:'Not queued yet'}},'POST',501);
sessionStorage.setItem('lanyard.staging.job',manual.jobId);
console.log('STAGING API CHECK PASSED');
~~~

Then:

1. Stop/restart the server with the same database and session. Redefine the helper if the page refreshed. GET `/api/profile-enrichment` must retain the saved answers/job and show no pending CV. GET the job ID in `sessionStorage` must still return manual.
2. In another signed-in account/browser, GET that job and POST removal of that upload ID must return 404; the other account sees none of the first account's staged identity/CV/job.
3. In the first browser, POST `/<jobId>/cancel` twice; both return the cancelled job. Stage different answers in a second tab, then start using the older answers with a fresh key: expect 409/selection_stale. No text is silently overwritten.
4. Sign out: owner state must return 401. A real-mode `x-demo-user` header or `convo_demo_user` cookie cannot bypass this.
5. Inspect only the **shape/counts** of the private row in Neon if needed; do not paste the raw document or SQL parameter logs into chat. The public user/profile/search evidence must remain unchanged by staging.

Cleanup: remove any remaining temporary upload through its API, cancel the created unaccepted job and restore the original staged answers if appropriate. Stop the local server and close/reset its task terminal. Do not delete shared users/requests or reset Neon. Keep the production feature off. Automated tests cover expiry, leases, retry races and bounded cleanup; this checklist does not ask you to wait 24 hours or pretend a worker exists.

ORCID checksum validation follows [ORCID's identifier specification](https://support.orcid.org/hc/en-us/articles/360006897674-Structure-of-the-ORCID-Identifier).
## Verification and current integration blockers (7 November)

Two critical review/test rounds pass **824 tests in 59 files, 98.56% line coverage**, with lint/typecheck passing for the feature stack plus Claude's `6924256` nullable compatibility patch in a validation-only checkout. No screen changes are bundled into this backend branch. Tests cover state races, owner boundaries, idempotency, private-input deletion, stalled/cancelled leases, partial collection, retry phase/evidence preservation, storage failures and the actual HTTP adapters with a versioned recorded Neon driver. Drizzle's local migration check passes. No live SQL/provider calls or production deployment were performed.

Review fixes included returning the contracted job from cancellation, keeping upload-removal tombstones for idempotency, correcting cleanup deadlines, preventing old leases from writing, distinguishing fatal job failure from per-source reasons, and avoiding full document rewrites for unchanged status polls. The collector/AI runner, approval/version enforcement and operational cleanup schedule remain unimplemented; active imports return not_ready.

An earlier functional integration with main `ccdffa7` (#47/#48/#49 merged) found **864/865 tests passing and two frontend type errors**. These findings were sent to Claude and subsequently fixed in `500352a`:

1. `src/app/(app)/matches/match-card.tsx`: its EvidenceKind label map needs `profile_page` and `cv` entries for the foundation's new evidence kinds. Keep the map compatible with both type versions (for example, infer the seven-key object rather than annotating it with the old five-key union).
2. `src/components/ui/person-badge.test.ts`: the nullable fixture passed to MatchDetails needs the `evidence` array added by #49 (an empty array fits this existing null-handle test). The missing field is also the one failing runtime test.

No frontend/B1 code was changed by Codex to hide those findings. #49 is now merged, so the agreed B1 dependency is clear. #47 owns main's migration 0005 and #50 now owns 0006; the foundation/auth/state migration chain must be regenerated against that merged schema before PR/Neon application. The temporary integration kept unresolved migration metadata isolated for code testing; it is not a deployable or published merge.

Updated integration: main `ccdffa7` + Claude's pushed compatibility `500352a` + foundation/auth/state through `f8836f1` pass **865/865 unit tests in 61 files, 98.61% line coverage**. A second focused pass passes **522 tests in 34 files**, with lint and typecheck clean. Both previously reported frontend failures are resolved. Migration metadata was isolated for functional testing only; this is not a deployable migration chain. No live providers, browser journey or SQL execution was tested.

Claude returned CONTRACT ACK on foundation `502bd6c` and confirmed auth `0a48eab` aligns. This branch is ready for backend code review, not merge; the ACK does not approve this later backend layer, migration execution or final feature acceptance. No PR was opened.

## Claude's state-layer review fixes

The three reported failures were reproduced before changing production code: an unclaimed queued job stayed stuck, later expiry overwrote cv_expired, and one unreadable owner blocked another owner's cleanup. Regression tests now cover the queued deadline (including legacy rows), fresh retry deadlines, stable expiry reasons, actual optimistic-write races, failed cleanup batches and failed deferral writes.

Cleanup returns `{processed,failed}`, counting successful and unsuccessful owners separately. Each failed due owner is deferred for ten minutes using metadata only; a newer future deadline is preserved. An unreadable document is neither reset nor logged. If the deferral write also fails, the owner remains due and the failed count still reports incomplete cleanup. Operators must repair unreadable documents and monitor failures before promising a physical-purge deadline.

Focused reproduction command, using recorded data only:

```powershell
npx vitest run src/server/profile/enrichment/state.test.ts src/server/profile/enrichment/state-concurrency.test.ts src/server/profile/enrichment/storage.test.ts
```

Main advanced to `d139e82` during this review. Combining it with compatibility `def5d74` exposes avatar/nullable merge conflicts in the badge component, badge form and availability form, in addition to B2 schema/migration conflicts. Claude must reconcile those screen files before current-main integration can be claimed. The state fixes are validated separately against the previously compatible main `ccdffa7`; no frontend conflict resolutions or migration metadata were published from the disposable validation checkout.

Both full review/test rounds pass **879 tests in 62 files**, with lint/typecheck clean and **98.62% line coverage**, using main `ccdffa7` + compatibility `def5d74` + these state fixes. No live providers, SQL, production settings or browser journeys were exercised. These results make the state-layer fixes ready for review, not the whole feature ready to merge.

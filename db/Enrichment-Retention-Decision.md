# Enrichment pilot retention decision

**Awaiting the user's choice. Recommended: the existing daily cleanup, with no hard physical-deletion deadline. This is not policy approval or release sign-off.**

## Inspected behavior

Code citations refer to fetched backend `5b3c6806ce1a9628e5fa2d0e159711c58854da21`. Read AGENTS.md, cleanup handoff, pilot runbook `67df3ec7c503ab026e89d48d22a2af1ecc09288e`, and `D:/Projects/convo-enrichment-final-testing/db/Enrichment-Completed-Tasks-Test-Results.md` (combined checkpoint `5fd76860906796e0b64fae1f1ceff165f8f3f959`). Existing passing regressions are accepted; no tests were rerun.

| Item | Actual behavior and source |
| --- | --- |
| Working-data lifetime | CV text: 24 hours from staging; job input/unapproved draft: 24 hours from creation. Expired selected CVs also invalidate their jobs. `src/server/profile/enrichment/model.ts:5`; `state.ts:116,211,24–35`. |
| Other records | Discovery: one hour; job history: 48 hours; removed-CV IDs: 24 hours after removal. Saved identity and approved profile/evidence have no working-data TTL. `state.ts:130,43–45,14`; `model.ts:7`; `approval.ts:43–59`. |
| Schedule | GET `/api/cron/enrichment-cleanup`, daily cron expression `17 3 * * *` (03:17 UTC nominally). Actual registration/timing is unverified. `vercel.json:4`; `db/Enrichment-Cleanup.md:63–74`. |
| Capacity and duration | 25 owners/batch, at most 40 batches: up to 1,000 owner attempts, not guaranteed throughput. Stop starting batches at 30 seconds; requested maximum 60 seconds. `storage.ts:63–66`; `src/app/api/cron/enrichment-cleanup/route.ts:16–20,44–52`. |
| Erasure and failures | Successful expiry writes clear working text/drafts and removed linked profile-cache entries. Failed owners are deferred ten minutes, without scheduling a retry. `state.ts:17–48,317–328`; `storage.ts:35–49,72–75`. |

Here `state.ts`, `model.ts`, `storage.ts` and `approval.ts` mean files under `src/server/profile/enrichment/`.

**Inaccessible is not physically erased.** App checks reject expired working data on access (`state.ts:48,83`; `approval.ts:23–34`); cache reads require an unexpired job/CV and cache age under 24 hours (`synthesis-cache.ts:6–26`). Successful access can erase contents before cron; idle rows await a successful sweep. Administrators can still access retained rows. UPDATE/DELETE establishes no erasure deadline for PostgreSQL old versions, WAL, backups or external providers; those periods are unverified.

## Recommended pilot choice and exact proposed wording

Keep daily cleanup with a named operator and best-effort removal from **active application storage**. The handoff's roughly 49-hour healthy-run estimate is not a maximum: delays, outages and capacity limits extend it. Promise neither “within 48 hours” nor “within about two days.” This choice needs no implementation/schedule change.

Proposed user-facing text, **not yet approved or published**:

> Your uploaded CV text expires 24 hours after it is prepared. Import inputs and unapproved drafts expire 24 hours after the import starts; an expired CV also ends any import using it. Expired working data can no longer be used in the app. We run daily cleanup to remove expired working copies from active application storage. Delays or failures can postpone removal, so we do not promise a fixed deletion deadline. Information you approve for your profile is kept separately. This cleanup does not establish a deletion deadline for backups or external providers.

## If a strict deadline is required

Define the clock, covered copies and failure assumptions; hold the pilot until supported. Hourly triggering adds margin but **cannot alone guarantee 48 hours**. Claude 1 would need durable retries/recovery, backlog-age monitoring/alerts, sufficient drain capacity and outage/capacity verification. All-copy erasure additionally needs reviewed database/backup/provider lifecycle guarantees. This system cannot promise an unconditional deadline through arbitrary outages.

The user authorizes costs/live work; Claude 1 owns root configuration; Person B sets private values. Gate/`.github/` and consent/privacy changes require the other person's approval under AGENTS.md. This memo authorizes none.

## Operator checklist — proposed, not executed

1. Before enablement: verify migration-before-deploy, private secret/job registration and a named operator checking every daily run, including missing invocations. Cleanup operates independently of the flag.
2. Record status/counts only. Investigate missing runs/timeouts, `500 partial`, `stoppedEarly`, `503 failed/not_configured` or `401 unauthorized`. `200 complete` covers only **currently due** rows (`route.ts:34–60`).
3. After authorized repair, manually invoke authenticated cleanup. Recheck failed owners after their ten-minute deferral; immediate zero-row success is insufficient. Repeat bounded runs until backlog clears, using authorized counts/deadlines, never raw documents/secrets. Escalate persistent failures/capacity issues to Claude 1; never reset history or silently raise limits.
4. Record policy and recovery evidence before release. The central report still requires committed flag-on/off browser configuration and authorized live migration/settings/two-account/deployed cleanup acceptance. No live timing was established here.

**One decision:** accept daily monitored cleanup without a fixed physical-deletion deadline, or require a strict deadline and hold the pilot for the work above. Only this document changed; no live work, secret access, PR or main merge occurred.

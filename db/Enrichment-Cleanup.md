# Scheduled cleanup of expired private enrichment input

Status: written on `b/enrichment-cleanup` (`2cd44af`, based on `b/enrichment-runner` `acd8cb9`), now integrated on `b/enrichment-backend-integration`, where the kernel defect below is fixed. See [the backend integration handoff](Enrichment-Backend-Integration.md).

**Changed:**
- the new route `src/app/api/cron/enrichment-cleanup/route.ts` and its tests;
- `cronSecret` in `src/server/config.ts`;
- an empty `CRON_SECRET=` in `.env.example`;
- a new `vercel.json` with one cron entry;
- this doc.

**Not changed:** the state and storage kernel, the contract, migrations and any Vercel setting. A kernel defect found while testing was reported below and is fixed in the integration branch.

## What it does

Vercel calls `GET /api/cron/enrichment-cleanup` once a day. The route reuses the existing kernel: `cleanupExpired()` in `state.ts`, which in turn uses `ownersDueForCleanup()` and `deferCleanup()` from `storage.ts`.

- **Batches:** each batch takes up to 25 owners whose `next_sweep_at` has passed, oldest deadline first. It runs them through the same `expire()` that every owner read already applies.
- **Removed per owner:** an expired pending CV, expired discoveries, expired removed-CV tombstones, and expired job input and collected excerpts. Job metadata past its 48-hour history is dropped.
- **Cache:** synthesis cache entries remembered on discarded jobs are deleted in the same version-guarded statement.
- **Kept:** unexpired input is untouched.
- **Repeat batches:** the route repeats batches until one finds nothing due. It stops starting new batches after 30 seconds or 40 batches (1,000 owner attempts), whichever comes first. `maxDuration` is 60 seconds.
- **Failures:** an owner that fails is counted, and the kernel defers it by ten minutes so the run moves on. It is retried on the next run.
- **Feature switch:** the route ignores `PROFILE_ENRICHMENT_ENABLED`, so input staged before the feature was switched off still expires.

Expired input is already unreadable before cleanup runs, because every owner read applies `expire()` first. This job **physically removes** it from Postgres.

### Authentication

- **No secret configured:** if `CRON_SECRET` is unset, empty or shorter than 16 characters, every request gets 503 `not_configured`.
- **Header check:** otherwise, the `Authorization` header must equal `Bearer <CRON_SECRET>` exactly. The comparison is constant-time over SHA-256 digests, so the secret's length doesn't leak.
- **Refused before storage:** both checks happen before any storage call. Tests prove that refused requests make no storage calls at all.
- **Production only:** Vercel sends this header itself when the project has a `CRON_SECRET` environment variable, and it calls only the production deployment.

### Responses

Every response is `Cache-Control: no-store` and contains only these fields. No owner IDs, private text, SQL or provider messages are returned, and nothing is logged.

| HTTP | `status` | Meaning |
| --- | --- | --- |
| 200 | `complete` | Every due owner was cleaned. |
| 500 | `partial` | Some owner attempts failed (`failed > 0`), or the run stopped at its budget with work possibly left (`stoppedEarly: true`). Non-2xx on purpose, so Vercel's cron log shows the run as failed. |
| 503 | `failed` | Storage couldn't list due owners. Counts cover what finished before that. |
| 503 | `not_configured` | No secret is set. |
| 401 | `unauthorized` | The header is missing or wrong. |

Field meanings:
- `processed`: owners cleaned.
- `failed`: failed owner attempts.
- `batches`: kernel calls made.
- `stoppedEarly`: the run hit its time or batch limit.

Overlapping or repeated runs are safe. Each owner update is fenced by its row version, and a second run finds nothing due.

## Schedule and plan limits

`vercel.json`:

```json
{ "crons": [{ "path": "/api/cron/enrichment-cleanup", "schedule": "17 3 * * *" }] }
```

The schedule is daily at 03:17 UTC, the most frequent schedule every Vercel plan accepts. The plan in use isn't recorded in this repo, so the setting is chosen to work on either.

Facts from Vercel's documentation, checked 2026-11-07:
- **Hobby:** cron jobs run at most once a day; more frequent expressions fail at deployment. A run may start anywhere in its scheduled hour, so 03:00–03:59 UTC here.
- **Pro:** cron can run up to once a minute, with per-minute precision.
- **All plans:** up to 100 cron jobs per project. Invocations are `GET` against the production deployment only, with `Authorization: Bearer <CRON_SECRET>`. Vercel doesn't retry a failed invocation, and two invocations can overlap.
- **Legacy status:** Vercel calls Cron Jobs a legacy feature that will move to *Schedules*. Schedules appears to be in public beta: on Hobby it runs at most every 15 minutes, and its requests default to `POST`. Cron Jobs remain supported with no removal date, so this branch uses them. When migrating, keep `"requestMethod": "GET"`; the `CRON_SECRET` check is unchanged.

**Cleanup window (worst case, from when the input was staged):**
- **Hobby (daily):** about 49 hours: the 24-hour lifetime, plus up to 24 hours until the next run, plus up to 59 minutes of start-time spread. That is just over the plan's proposed 48-hour target.
- **Pro:** change the schedule to hourly (`"17 * * * *"`) for about 25 hours.
- **Failed owners:** an owner that fails in a run waits for the next one; on a daily schedule, that's another day.

**Unresolved: the 48-hour physical-deletion target is not met on a daily schedule.** This needs your decision; nothing here changes a plan or adds a paid service:

1. **Accept about 49 hours.** Keep the daily schedule and describe deletion as "within about two days", not "within 48 hours".
2. **Pro plan, hourly schedule.** Change the expression to `"17 * * * *"` for about 25 hours. Deployment fails on Hobby with this expression, so change it only once the project is on Pro.
3. **A second free trigger.** For example, a scheduled GitHub Actions workflow calling the endpoint with the secret. `.github/` is a gated folder that needs both people's approval, GitHub's own schedule is also best effort, and the workflow would need the secret as a repository secret.

Until then, expired input is still unreadable after 24 hours, because every read applies `expire()` first. Only physical removal from Postgres can take up to about 49 hours. Don't describe deletion as "within 48 hours" anywhere until one of these is chosen and verified.

**Monitoring and recovery** (whichever option is chosen):
- Check the Cron Jobs log after each run for the first week, then weekly.
  - **200 `complete`:** that run's due rows are done.
  - **500 `partial`:** some owners failed. They were deferred ten minutes, but nothing runs again until the next scheduled run. Investigate the cause (for example, an unreadable stored document, which is never reset automatically), then trigger a run by hand: open the cron job in Vercel and choose Run, or call the endpoint with the secret.
  - **503 `failed`:** storage was unreachable or the migrations are missing. Fix that, then run by hand.
  - **`stoppedEarly: true`:** the batch budget ran out. Run again by hand; if it repeats, investigate before raising limits.
- A failed or skipped run adds a day to physical deletion on the daily schedule. Unreadability at 24 hours doesn't depend on runs.

**Capacity:** each run covers up to 1,000 owner attempts in 30 seconds of batching. That is far beyond the expected daily volume. If `stoppedEarly` shows up repeatedly, investigate before raising the limits.

Sources:
- [Cron Jobs usage and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing)
- [Managing Cron Jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs)
- [Migrating from Cron Jobs to Schedules](https://vercel.com/docs/schedules/migrate-from-cron-jobs)

## Kernel defect (found here, fixed in the integration branch)

When every selected source came back empty, `finishDraft()` set the job to `manual` but kept `job.input`. Two problems followed:

1. **Private input outlived its 24-hour lifetime.** The input, which could include pasted public-profile text, stayed until the job's 48-hour history ended.
2. **The row was never rescheduled.** `mutateOwner` skipped every write for an unchanged document, so the stale `next_sweep_at` stayed in the past. The row was picked first by every batch and could starve other owners.

The fixes, on `b/enrichment-backend-integration`, each with a failing-first regression:
- `finishDraft` now clears `input` and `collected` when a job ends `manual`. Manual jobs are never retried.
- `expire()` also clears them from **manual jobs already stored by earlier code**, so those rows stop holding input and stop pinning a past deadline. Job history and any pending CV are kept.
- `mutateOwner` now rewrites the deadline, version-guarded, whenever the stored value differs from the computed one, even when the document is unchanged.

The regressions are in `state.test.ts` (a new manual completion, and a stored manual row with input processed alongside another owner), `storage.test.ts`, and this route's starvation test.

## Setup (deployment, needs the user's approval)

Person B sets Vercel variables (AGENTS.md).

1. **Migrations before any deployment of this code.**
   - Apply and verify the reviewed chain (`0007`–`0010`), following the order and checks in `Enrichment-Migrations.md` and `Enrichment-Backend-Integration.md`.
   - Do it even with the feature off: ordinary profile reads select the new user columns, and cleanup needs `profile_enrichment_states` (without it, the run answers 503 `failed`).
   - Never reset data.
2. Generate a secret locally and keep it out of chat, screenshots and commits. In PowerShell: `[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))`, or `openssl rand -base64 32`.
3. In Vercel, open the project's Settings, then Environment Variables. Add `CRON_SECRET` for **Production**. Preview is unnecessary, since cron jobs never call previews.
4. Only after step 1 is verified: merge to `main` with `vercel.json` and redeploy production. A changed secret only takes effect after a redeploy.
5. In Vercel, open the project's Settings, then Cron Jobs. Expect `/api/cron/enrichment-cleanup` at `17 3 * * *`. After the next run, the invocation log should show 200. A 500 `partial` or 503 `failed` needs the steps under Monitoring and recovery.
6. Keep `PROFILE_ENRICHMENT_ENABLED` off until the whole feature passes acceptance. Cleanup runs either way.
7. Before enabling imports, retire any older deployment that still writes evidence the old way (see `Enrichment-Approval.md`), so it can't overwrite approved evidence.

## Complete manual checklist

**Local, no credentials or services:**

1. From this worktree: `npx vitest run src/app/api/cron --maxWorkers=2`. Expected: 16 passed. They cover:
   - a missing or empty secret (503) and six bad headers (401), none of which touch storage;
   - expired CV, job input and cache removed, while unexpired input is kept;
   - counts only in the response, and no console output;
   - a repeat run doing nothing;
   - the feature switched off;
   - 60 owners across 4 batches;
   - one failing owner (500 `partial`, deferred ten minutes);
   - a storage outage (503 `failed`);
   - the time budget (`stoppedEarly`);
   - the daily schedule in `vercel.json`.
2. `npm run lint`, `npm run typecheck`, then `npx vitest run --maxWorkers=2`. Expected: all pass.
3. Optional HTTP check without a database:
   1. Start `npm run dev` with `FAKE_API=1` and **no** `CRON_SECRET`. Run `curl.exe -i http://localhost:3000/api/cron/enrichment-cleanup`. Expected: 503 `{"status":"not_configured"}`.
   2. Restart with `CRON_SECRET=local-test-secret-123456` (a throwaway value). With no header, or `-H "Authorization: Bearer wrong"`, expect 401 `{"status":"unauthorized"}`.
   3. With `-H "Authorization: Bearer local-test-secret-123456"` and no `DATABASE_URL`, expect 503 `{"status":"failed",...}` with no error text.
   4. Stop the server.

**Live, only after approval, on a test database:**

4. With the migration chain applied to a test database, stage a CV text through the owner API (`POST /api/profile-enrichment/cv`) with a test account. Don't move the shared database clock. Call the endpoint once with the right header. Expected: 200 `complete` with `processed: 0`, because nothing is due yet, and the staged CV remains.
5. More than 24 hours later, or on a test database where you can create an already-expired row by normal use, call it again. Expected: `processed` at least 1. The owner's pending CV is gone (`GET /api/profile-enrichment` shows no pending CV). Any synthesis cache for a discarded job is deleted.
6. After the first scheduled production run, check Vercel's Cron Jobs log for 200.

**Cleanup:** stop local servers and drop throwaway local secrets. Leave Vercel settings, the feature flag and migrations as they were unless a deployment was approved.

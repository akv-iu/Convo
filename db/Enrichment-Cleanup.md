# Scheduled cleanup of expired private enrichment input

Status: `b/enrichment-cleanup`, based on `b/enrichment-runner` `acd8cb9`.

**Changed:**
- the new route `src/app/api/cron/enrichment-cleanup/route.ts` and its tests;
- `cronSecret` in `src/server/config.ts`;
- an empty `CRON_SECRET=` in `.env.example`;
- a new `vercel.json` with one cron entry;
- this doc.

**Not changed:** the state and storage kernel, the contract, migrations and any Vercel setting. A kernel defect found while testing is reported to Codex below; this branch doesn't fix it.

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

- **No secret configured:** if `CRON_SECRET` is unset or empty, every request gets 503 `not_configured`.
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

Say "within about 49 hours on a daily schedule" in user-facing copy unless the project is on Pro with the hourly schedule.

**Capacity:** each run covers up to 1,000 owner attempts in 30 seconds of batching. That is far beyond the expected daily volume. If `stoppedEarly` shows up repeatedly, investigate (see the defect below) before raising the limits.

Sources:
- [Cron Jobs usage and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing)
- [Managing Cron Jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs)
- [Migrating from Cron Jobs to Schedules](https://vercel.com/docs/schedules/migrate-from-cron-jobs)

## Kernel defect reported to Codex (not fixed here)

When every selected source comes back empty, `finishDraft()` sets the job to `manual` but keeps `job.input`. `createJob` clears input only for jobs that start as `manual`. Two problems follow:

1. **Private input outlives its 24-hour lifetime.** `expire()` treats `manual` as finished and never discards it. The input, which can include pasted public-profile text, stays until the job's 48-hour history ends.
2. **The row is never rescheduled.** `nextSweepAt()` still counts that job's 24-hour deadline, because its input is non-null, but `expire()` changes nothing. `mutateOwner` therefore returns without writing, and `next_sweep_at` stays in the past. The row is picked first in every batch, and 25 such rows would starve every other owner's cleanup. This route stays bounded, but such a run would end `partial` with `stoppedEarly: true` every time.

A repro test, written to the correct behaviour and failing today, was handed over separately. It runs `createJob`, `claimJob`, `recordCollection` with every source empty, and `finishDraft`, then moves time past 24 hours and runs `cleanupExpired()`. It expects the job's input to be null and the row to be no longer due.

Suggested fix: clear `job.input` (and `collected`) when `finishDraft` ends in `manual`. Separately, make `mutateOwner` write a new `next_sweep_at` even when the document is unchanged, so a stale deadline can never stick.

## Setup (deployment, needs the user's approval)

Person B sets Vercel variables (AGENTS.md).

1. Generate a secret locally and keep it out of chat, screenshots and commits. In PowerShell: `[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))`, or `openssl rand -base64 32`.
2. In Vercel, open the project's Settings, then Environment Variables. Add `CRON_SECRET` for **Production**. Preview is unnecessary, since cron jobs never call previews.
3. Merge to `main` with `vercel.json` and redeploy production. A changed secret only takes effect after a redeploy.
4. In Vercel, open the project's Settings, then Cron Jobs. Expect `/api/cron/enrichment-cleanup` at `17 3 * * *`. After the next run, the invocation log should show 200 (or 500 `partial`, which needs investigating).
5. Apply the reviewed migration chain first. Without `profile_enrichment_states`, the run answers 503 `failed`.
6. Keep `PROFILE_ENRICHMENT_ENABLED` off until the whole feature passes acceptance. Cleanup runs either way.

## Complete manual checklist

**Local, no credentials or services:**

1. From this worktree: `npx vitest run src/app/api/cron --maxWorkers=2`. Expected: 15 passed. They cover:
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

# Profile enrichment pilot: setup and acceptance runbook

**Status: preparation only. Nothing in this runbook has been executed against accounts, providers or a database.** Keep production enrichment disabled. Perform LIVE steps only after explicit authorization, against the intended pilot/test environment. This document does not authorize migration application, deployment, paid calls or feature sign-off.

## 1. Release prerequisites and known blockers

Prepared from backend integration `0151790`, frontend integration `5108092`, boundary audit `704dbd0` and release audit `3ec54f3`. These are development checkpoints, not the final combined release. Before using this runbook, record the final combined commit, target database/environment, operator, approvals and current author/CI results. Recheck newer fixes rather than assuming these checkpoint findings remain open.

| Item | Evidence at the inspected checkpoints | Required before acceptance |
| --- | --- | --- |
| Runner discovery fixture | Corrected at `216e994` | Final combined typecheck/unit results |
| Empty/manual input and stale cleanup deadlines | Fix committed at `6b9a586` | Targeted fix review and final combined results |
| OpenAlex runner setting | Reads central config at `0151790` | Matching private value in the target environment |
| Late CV upload after newer choices | Boundary finding 1 | Claude 1's fix and deferred-upload regression |
| Draft edits/evidence choices lost on reload/retry | Boundary finding 2 | Claude 2's fix and browser regressions |
| Final CV worker packaging | Source-branch artifact evidence exists | Final integration build and route trace evidence |
| Retention schedule | Daily cron proposal; timing gap documented | Actual supported schedule/plan, monitoring and an explicit retention decision |
| Complete frontend/backend merge | Separate development branches | One reviewed combined commit and required checks/approvals |

See [boundary findings](https://github.com/akv-iu/Convo/blob/704dbd0/db/Enrichment-Boundary-Audit.md), [release audit](https://github.com/akv-iu/Convo/blob/3ec54f3/db/Enrichment-Release-Audit.md) and [feature checklist](https://github.com/akv-iu/Convo/blob/0151790/docs/features/profile-enrichment.md). Sign-in, consent/privacy, migration backfills and shared gate changes must receive the approvals required by AGENTS.md. Do not mark the feature complete from component test counts or fake browser success. Cross-branch handoff links are pinned so they remain readable before those documents reach main; reconcile them with the final release commit.

## 2. Settings and account preparation

Person B configures real values privately. Use the target's own local private environment file or Vercel environment settings; do not commit values, print environment dumps or put server keys in NEXT_PUBLIC_ variables. Restart/redeploy after changing module-loaded settings. Keep local, pilot/Preview and production credentials/callbacks matched to their exact origins.

| Setting | Purpose and placement |
| --- | --- |
| `FAKE_API` | `1`: fixture API, no real authentication/import through application routes. `0`: real routes. |
| `PROFILE_ENRICHMENT_ENABLED` | `0` in production before acceptance. Set `1` only in the authorized test environment for the new flow. This also controls Google sign-in availability. |
| `FAKES` | Optional `search,ai` for real routes with canned search/AI. Clear for real Elasticsearch/OpenAI acceptance. This does **not** fake OAuth, Neon, GitHub, discovery or CV page retrieval. |
| `AUTH_SECRET` | Existing private Auth.js cookie/session secret. Keep it stable; do not rotate it as a setup shortcut. |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | Google web OAuth client ID/secret for that exact environment. |
| `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET` | GitHub OAuth app client ID/secret for that environment. Neither is a personal access token. |
| `DATABASE_URL` | Intended Neon connection, including migration target. Privately verify the actual database/branch and backup first. |
| `OPENALEX_API_KEY` | Server-only research discovery/import key from the user's OpenAlex account. ORCID is an optional lookup identifier, never a login credential. |
| `BRAVE_SEARCH_API_KEY` | Server-only public-profile candidate search key from the user's Brave Search API account. Confirmed page retrieval uses the checked public URL; it does not unlock private/login-only pages. |
| `OPENAI_API_KEY` | Existing private project key for real refinement/explanations/profile synthesis. Paid calls require authorization. |
| `ELASTICSEARCH_URL`, `ELASTICSEARCH_API_KEY` | Existing intended cluster and scoped application key. Never rebuild a shared index as routine setup. |
| `CRON_SECRET` | Random private header-safe secret for scheduled cleanup. Set in Production for the deployed cron; use a different throwaway value for a separately authorized local cleanup test. |
| `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS` | Existing working Dash0 export values; retain their private authorization header. Follow [Dash0 setup](Dash0.md). |

### OAuth setup

1. Use [the complete authentication setup](https://github.com/akv-iu/Convo/blob/0151790/db/Google-GitHub-Auth.md#complete-provider-setup-do-only-before-authorized-live-acceptance). In Google Auth Platform, configure branding/audience and pilot test users where required, then a Web application client. Requested scopes are `openid profile`; no Gmail, Drive, email, offline access, API key or service account is needed by this implementation.
2. Register the exact Google redirect: `http://localhost:3000/api/auth/callback/google` locally, or `<pilot-or-production-https-origin>/api/auth/callback/google` for the selected deployment. Replace the placeholder with the actual origin; arbitrary Preview URLs are not automatically registered.
3. Retain separate local/deployed GitHub OAuth apps with callbacks `http://localhost:3000/api/auth/callback/github` and `<deployed-https-origin>/api/auth/callback/github`. No additional optional GitHub scopes are requested. The internal `/api/auth/connect/github` path is **not** the provider callback.
4. Authentication creates/opens the Lanyard account. Import checkboxes independently control profile enrichment. Google subject ownership is stored; Google name/email/picture/tokens are not copied into the saved profile. GitHub's token stays in the encrypted HttpOnly session and callback memory, not a public API response.
5. For acceptance, use two distinct Lanyard owners: A signs in with Google; B signs in with GitHub. To test a successful GitHub connection to A, also use an unused GitHub account that has no separate Lanyard owner. B's already-owned GitHub is the refusal case. The user controls all sign-ins; agents never need passwords or tokens. Linking never merges accounts by name/email.

## 3. Credential-free local checks — not live acceptance

Use the final combined checkout, pinned dependencies and supported Node 22.18+ on the 22 line or Node 24, as documented by the CV handoff. Use a physical worktree-owned node_modules directory. Never clear another checkout's dependencies through a junction. Use a credential-free checkout without a real .env.local for fake builds/tests.

The implementation owner runs **one final verification pass**: lint, typecheck, unit tests with coverage and required browser/build checks at the end of the task. Reviewers reuse that evidence. If checks find defects, fix and rerun affected checks; a full repeat is needed only when the fix warrants it. [The single-pass workflow](https://github.com/akv-iu/Convo/blob/212fb27/AGENTS.md) supersedes older two-round handoffs; CI gates remain required.

Typical final author checks are `npm run lint`, `npm run typecheck`, `npm test -- --coverage --maxWorkers=4`, and `node ./node_modules/drizzle-kit/bin.cjs check`. They use fixtures/mocks and must not contact providers or Postgres. Do not run migration generation merely to manufacture new files for acceptance.

Frontend checkpoint `5108092` has one default Playwright server, not a completed flag-off/on project matrix. Do not run every enrichment spec under the same flag and call that a complete gate. Claude 2 must publish the final browser commands/results. Interim selectors, in a credential-free PowerShell terminal, are:

```powershell
$env:CI = "1" # start the test-owned server rather than reuse another window's server
$env:FAKE_API = "1"
$env:PROFILE_ENRICHMENT_ENABLED = "0"
npx playwright test tests/e2e/enrichment-off.spec.ts
$env:PROFILE_ENRICHMENT_ENABLED = "1"
npx playwright test tests/e2e/enrichment/
```

The first selector proves only the new off-switch guard, not the complete existing flag-off screen suite. The second selects the enrichment journeys on both configured devices. Both build/start the test app through Playwright's config. Do not stop another window's server to free a port. Close the temporary terminal afterward to discard shell overrides. Fake results do not prove real sign-in, provider access, indexing or retention. `/api/health` and authorized cron cleanup check real dependencies even when the app API is fake; they are not offline shortcuts.

## 4. LIVE migration application — before deploying new consumers

1. Stop until the final schema/migrations and required approvals are reviewed. Choose a pilot/test Neon target, verify its backup/restore point and actual migration history privately, and review **all** outstanding SQL. If any old provisional enrichment migration was applied, reconcile first; never reset the database or edit recorded migration history to force a pass.
2. The reviewed chain after main `576692d` is `0007_provider-identities`, `0008_auth-link-attempts`, `0009_enrichment_state`, `0010_approved_profile_evidence`. Main's existing migration files stay unchanged. Later merged work may extend this chain: use the final checkout, not an obsolete branch.
3. Keep enrichment off. After migration authorization, run from that final checkout with the intended private file:

   ```powershell
   node --env-file="C:\Private\lanyard-pilot.env" .\node_modules\drizzle-kit\bin.cjs migrate
   ```

   Replace only the file path. An existing shell DATABASE_URL overrides the file; verify the target privately first. Pass `--env-file` to Node directly, never through NODE_OPTIONS. The package's `npm run db:migrate` does not itself load .env.local. Stop on an error; do not blindly retry or delete migration records.
4. Run [the existing read-only verification queries](https://github.com/akv-iu/Convo/blob/0151790/db/Enrichment-Migrations.md#verify-in-the-intended-neon-sql-editor) in that target's SQL editor. Expect three new tables (`auth_identities`, `auth_link_attempts`, `profile_enrichment_states`); nullable GitHub handle; the five 0010 columns; expected unique/sweep indexes; recorded migrations; and no missing legacy numeric GitHub identity mappings. Existing users, asks, requests and avatars remain intact. Never select private staging documents or session hashes for screenshots.
5. The authorized idempotency re-run of the same migration command should apply nothing new. **Apply and verify before deploying code that reads the new columns**, even with enrichment off: ordinary profile reads depend on 0010. Cron additionally needs 0009. Retire incompatible old evidence writers before enabling imports.

## 5. LIVE deployment/build prerequisites

Deploy only the reviewed final commit to the authorized pilot environment, with exact OAuth callbacks and private settings. Preserve the production-off setting. Preview settings and their real dependencies must be explicitly chosen; Preview is not inherently a fake or isolated database.

| Test mode | FAKE_API | PROFILE_ENRICHMENT_ENABLED | FAKES | What it establishes |
| --- | --- | --- | --- | --- |
| Credential-free screens | 1 | 0, then 1 in separate runs | Unset | Fixture-backed UI and switch behavior only |
| Authorized mixed backend | 0 | 1, test environment only | search,ai | Real OAuth/Neon/source imports with canned matching/synthesis; still contacts live sources |
| Authorized final pilot acceptance | 0 | 1, test environment only | Unset/removed | Real search, AI and source integrations; may consume credits |

Change these only in the chosen test environment, then restart/redeploy. Do not change production's existing FAKE_API/FAKES settings as a side effect of setup. Final acceptance requires the last mode, not only mixed-mode success.

- Final build evidence must include the CV route's file trace, emitted worker/parser and unpdf/Mammoth artifacts. Source-branch artifacts alone do not prove the combined build or deployed worker. Test a small PDF and DOCX on the actual authorized deployment.
- Start/retry request 90 seconds; cleanup requests 60 seconds with a 30-second batch-start budget. Verify the actual deployment supports/enforces these limits. after() is best effort, not a durable queue; interrupted work becomes stalled and needs explicit retry.
- The current `vercel.json` schedules GET `/api/cron/enrichment-cleanup` with `17 3 * * *` (UTC). Confirm actual registration and supported scheduling on the user's hosting plan. The existing cleanup handoff warns that daily timing spread can allow roughly 49 hours before physical deletion even with successful runs; errors/budget limits can extend it. Do not promise a strict 48-hour deletion bound from this configuration. A different supported schedule or an explicit revised retention decision remains pending.
- Cleanup must run with the feature off and expose counts only. Review failed/partial invocations; confirm and authorize recovery rather than relying on an automatic retry. Account cron registration/limits, real lock behavior and cleanup capacity are unverified here.
- `/api/health` performs live Postgres/Elasticsearch/OpenAI checks, reporting up/down with 200/503 and sanitized bodies. Call it only as part of authorized live checks. It does not establish Brave/OpenAlex/worker readiness.

## 6. Complete LIVE acceptance checklist — NOT RUN

Use the same reviewed combined commit and authorized target throughout. Finish all blockers above first. A and B use separate browser profiles/sessions; all people/evidence used for tests are controlled by the testers or public material they intentionally select. Use a small fictional CV and a public page you control. Record pass/fail, commit and sanitized observations, never credentials or raw private input.

For optional API-only steps, run this helper on the app's own page in the signed-in owner's DevTools. Redefine it after a full reload. It uses the existing HttpOnly cookie and never asks for an access token:

```js
async function enrich(path = "", body) {
  const response = await fetch("/api/profile-enrichment" + path, {
    method: body === undefined ? "GET" : "POST", credentials: "same-origin",
    ...(body === undefined ? {} : {
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
    })
  });
  return { status: response.status, body: await response.json() };
}
```

| Step | Action | Expected result |
| --- | --- | --- |
| 1. Signed out | Visit `/signin`, enter name/workplace and optional ORCID; proceed to `/signin/sources`. Also call owner-state GET while signed out. | Page 2 offers Google/GitHub sign-in; owner API returns 401/sign_in_required. Inputs do not prove identity. |
| 2. Google-only A | Turn GitHub import off; sign in with Google and return to page 2. | State has signIn.provider google and no connected GitHub; onboarding is unfinished. No GitHub data import starts. No GitHub handle/link is invented. |
| 3. Sign-in cancellation | In another clean session, cancel/deny a provider sign-in. | Return to `/signin/sources` with a known reason/help, not an unexplained OAuth error page or another user's session. |
| 4. Linking | As A, try connecting B's already-owned GitHub, then the unused GitHub account. | First returns github_linked_elsewhere without switching/merging accounts. Second returns to page 2 with A still owner and the confirmed login. Cancelled linking returns github_connect_cancelled. Bare connect GET cannot initiate linking. |
| 5. Research | Enable Research, search using name/workplace or a valid known ORCID, open candidate links and select the correct author or Skip. | Up to four HTTPS human-readable author candidates. No automatic selection. No match/unavailable outcomes have honest help/retry. Import selects up to ten public papers; abstract only when available; nothing is written to ORCID/OpenAlex. |
| 6. Public profile | Enable Public profile and try a candidate, a different HTTPS link, pasted professional text, and Skip in separate confirmations. | Only one choice at a time. Checked links/snippets render safely. Unavailable/blocked pages have honest fallback; no private/login-only scraping. Pasted evidence has neutral title Profile text and no URL. |
| 7. CV success | Upload a small text PDF, replace with DOCX, then try pasted text. | Owner-only metadata reports filename (null for pasted text), character count, warnings and expiry. New input replaces the prior pending upload; no file bytes/raw CV appear in responses/public cards. |
| 8. CV limits/revocation | Try an oversized (>2 MiB), encrypted, unsupported or image-only CV and a >30,000-character extracted CV. Separately turn CV off/confirm newer choices while parsing is pending. | Documented 413/cv_too_large, 415/cv_unsupported, or 422/cv_encrypted/cv_unreadable; truncation reports cv_truncated. Failed replacement preserves current input. Late older upload cannot resurrect input or cancel newer work. Requires the audit fix. |
| 9. Start and preferences | Confirm sources; continue through badge/visibility and availability while import runs. Hide country/workplace/hiring on cards; save free times. | Flow is page 2 -> `/onboarding` -> `/onboarding/free-time` -> `/onboarding/profile`. Import produces progress/draft; badge/availability saves complete onboarding before approval. Public bio/evidence is unchanged until approval. |
| 10. Draft recovery | Edit bio/expertise and evidence picks. Retry a partial source, reload a stale draft, refresh/open another tab, and recover from a temporary polling failure. | Recovery is honest; the agreed edit-preservation paths retain words and valid picks, drop removed IDs, and leave new CV excerpts unselected. No silent reset on retry/conflict. Refresh resumes owner job/state; unsaved edits across full browser refresh are not assumed durable unless final UI documents it. |
| 11. Approval | Check generated claims, remove wrong evidence, keep CV excerpts unselected unless deliberately approving them, then approve edited bio/expertise. | 200 with sync.status confirmed, pending or not_onboarded. Only picked evidence is saved; pending is a successful save with retry, not lost work. Text/choices/visibility/availability persist after refresh/sign-in. Hidden-info warnings remain owner-only; an explicitly approved bio may still mention hidden facts by design. |
| 12. Search and visibility | As B, finish onboarding/free times and ask about A's known approved work. Test relevant hard filters. | With real search, A's approved evidence can support results; raw CV and unapproved items do not. Hidden structured country/workplace/hiring values stay off cards while still usable for matching. Google-only/null-handle people have no fabricated GitHub link in cards/inbox/resolve. |
| 13. Partial failure | With separately approved failure injection in the isolated test deployment, make one selected provider unavailable and import again. | Other successful sources yield a partial draft, sanitized source help and retry. No credential/provider body leaks. The successful sources remain collected on retry. Do not disrupt shared/production endpoints. |
| 14. Stale/cancelled work | Edit the saved profile bio after a draft starts, then attempt old acceptance. Separately cancel/supersede a running job. Replay an identical start and an old delayed callback/retry scenario using author regression evidence where timing cannot be controlled live. | Stale text returns 409/text_changed; stale consent/draft conflicts appropriately. Duplicate start retains the same job; changed body with same key conflicts. Cancelled/older attempts cannot publish or restore cache/evidence. Do not claim manually reproducing precise callback ordering without evidence. |
| 15. Pending index recovery | After separate authorization, isolate a search outage during approval; preserve only that accept request's JSON payload from Network/Payload, without headers/cookies. Restore search and resend the identical body to the same accept route. | Initial save returns 200/pending and is durable; pending evidence is withheld from other users' results. Identical retry confirms sync without another profile/text save. Changed accepted body conflicts. No production outage injection. See the detailed approval handoff. |
| 16. Owner isolation | As B, use A's test job ID for GET/accept and A's source/upload IDs for removal. Test foreign evidence IDs only against your test accounts. | Owner lookups return 404 without creating/modifying foreign state; foreign acceptance IDs are rejected. No raw private input or credentials are exposed. |
| 17. Withdraw and persist | As A, list approved sources, withdraw one, repeat removal, refresh/sign in, and optionally perform a separately authorized search rebuild on an isolated index. | removed true and reviewBio true; that source disappears from evidence, others remain. Old jobs cannot restore it. Repeated removal can repair pending sync. Previously edited bio is preserved, so review/remove claims that still mention withdrawn material. |
| 18. Two-owner app flow | B sends a request to A, A accepts or answers, then use a fresh accepted request to select a mutually free future slot. Repeat the same booking and refresh. | Inbox/response ownership works; suggested slots reflect saved availability. Booking persists and retries are idempotent. Synthetic profiles cannot act as the second signed-in owner. Avoid reusing an already-booked slot for an independent test. |
| 19. Operational cleanup | Check missing/wrong-secret refusals without revealing the secret. After separate cleanup authorization, run against the test target before expiry, then after natural expiry or a separately reviewed dedicated expired-data fixture. | Missing secret: 503/not_configured; wrong header: 401/unauthorized, neither touches storage. Authorized run: 200/complete, or visible 500/partial/503/failed needing investigation; counts only. Unexpired input remains; expired input/cache is erased. Never change the shared database clock. |
| 20. Final evidence | Check the scheduled invocation and sanitized traces/logs; compare the final commit/results to both audits. | Real deployed parsing/after()/cron/index behavior is evidenced; no raw CV, provider token or provider error text in diagnostics. Untested retention/timing remains explicitly pending; feature sign-off requires the other person to try the final preview. |

### API-only actions when a screen does not expose them

`await enrich()` returns owner state; obtain its jobId from body.job.jobId. `await enrich('/' + encodeURIComponent(jobId))` returns progress/draft. Retry/cancel use the same path plus `/retry` or `/cancel` with `{}` as the helper's body.

Use `await enrich('/sources')` to list approved source IDs, then `await enrich('/sources/' + encodeURIComponent(sourceId) + '/remove', {})`. Pending CV removal is `await enrich('/cv/' + encodeURIComponent(uploadId) + '/remove', {})`. IDs come from the current owner's state/list, never guessed. Signed-out/foreign-owner cases deliberately use the other controlled test session.

Acceptance is POST `/<jobId>/accept` with exactly `{draftVersion, baseTextVersion, bio, expertise, evidenceIds}`. Versions/IDs come from that job's current draft; expertise is an array of strings and evidenceIds contains only explicitly chosen current IDs. The UI is preferred for testing consent; API calls must not silently select all CV excerpts. Replay the exact saved JSON body for pending synchronization; do not replace it with a freshly generated draft. Full examples and expected conflicts are in [the approval checklist](https://github.com/akv-iu/Convo/blob/0151790/db/Enrichment-Approval.md#complete-manual-checklist-future-authorized-live-check).

## 7. Cleanup, disabling and sign-off

Cancel unaccepted test jobs and remove staged CVs through owner APIs. Withdraw test sources deliberately if desired and review leftover bio text. Stop only test-owned local servers, close the temporary shell, and discard temporary fixtures/private test payloads and throwaway local secrets. Restore authorized test-only failure settings. Do not delete shared users with requests/bookings, reset tables, revert migration history or rebuild shared indexes as cleanup.

Before any Google-only pilot users are released, keep/restore production `PROFILE_ENRICHMENT_ENABLED=0` and leave production settings otherwise unchanged. **After release, do not blindly flip this flag off:** it also hides Google authentication and re-enables the legacy GitHub import path. Use an explicitly reviewed account-access/compatible rollback plan first; keep cleanup operating and preserve schema/evidence. Any temporary restriction, deployment or setting change needs the relevant operator authorization.

Final enablement remains blocked until implementation findings are closed, required CI and feature approvals pass, the intended migrations/settings are verified, real acceptance evidence exists and retention limits are honestly agreed. This runbook supplies instructions, not a passing checklist or permission to enable production.

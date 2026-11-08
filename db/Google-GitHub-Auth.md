# Google/GitHub authentication: implementation and handoff

Status: backend implementation for review, not production-ready. Branch `b/google-github-auth`, based on the revised enrichment foundation. Do not open/merge its PR before the foundation and nullable-screen compatibility patch land and Claude returns CONTRACT ACK. No live OAuth or Neon test has been run, and no migration or environment setting has been applied.

## What changed

With `PROFILE_ENRICHMENT_ENABLED=0`, GitHub's existing consent/import flow remains. With the feature enabled, Google and GitHub authenticate using provider subjects, and optional source imports no longer happen during authentication. New users stay unfinished until onboarding supplies their chosen name and filters. Existing profile edits, evidence, badge, visibility and availability remain saved. Refreshing a GitHub handle synchronizes the saved snapshot, but a search outage cannot prevent sign-in.

Google requests `openid profile`, with Auth.js verifying the OIDC response, state, nonce and PKCE. We persist only its subject/account mapping and user-entered profile data. Google name, email, picture and access/refresh/ID tokens are not copied into the saved profile or session. GitHub authenticates with its numeric account ID/login and no optional OAuth scopes. Its access token stays only inside the encrypted, HttpOnly Auth.js session cookie; the browser-readable session returns the Lanyard user ID. No provider credentials appear in the connection table or logs.

One provider subject has one owner. Renaming a GitHub handle does not change ownership. A linked GitHub can sign into its Google-created Lanyard account. No automatic email/name matching, account merging or attaching an already-owned GitHub is allowed.

## Frontend coordination

- Import `signIn` from `@/server/auth` in the frontend's server actions. Normal authentication uses `signIn("google", {redirectTo: PAGE_TWO})` or GitHub, after safely preserving the page-one draft. Keep OAuth callback URLs at `/api/auth/callback/google` and `/api/auth/callback/github`.
- Connecting GitHub to an authenticated account MUST use the contracted `connectGitHub` API, then navigate to the returned `path`; do not call normal GitHub sign-in for this button. The real response is `{status:"redirect",path:"/api/auth/connect/github?token=<single-use attempt>"}`; fake mode still returns its recorded connection.
- A token returned only by the origin-checked POST is required in that path, alongside its private cookie; bare GET cannot start linking. It is owner/session-bound, expires after ten minutes, and is consumed when the OAuth state is recorded. The redirect disables caching and referrers. A ten-minute private attempt binds the current cookie session to the exact OAuth state. The database claims that attempt and GitHub subject together. Lost/stale/consumed attempts, changed sessions and identity conflicts cannot become a normal sign-in or switch the user. Used states remain for one day past expiry to detect lost cookies; old records are removed when a new attempt starts.
- The return URL is exported by `src/contracts/enrichment.ts` as `ENRICHMENT_RETURN_PATH = "/signin/sources"`, shared with Claude's sign-in actions. Success uses the bare path and re-reads state; cancel/deny/refusal use `?reason=` with the agreed codes. `/onboarding/*` has no shared authentication guard today, so the new page can show sign-in buttons while signed out. Discovery/upload APIs still require sign-in.
- Read the fixed `reason` code on return: `sign_in_cancelled`, `github_connect_cancelled`, `github_linked_elsewhere`, `github_reconnect` or `provider_down`. Never display provider query/error text.
- Real GET owner state and POST Connect GitHub are implemented here. Other real enrichment routes intentionally remain 501; page-one identity staging, discovery, uploads, jobs and approval are the next backend phase. Owner state currently has null identity/job/pendingCv until those services land.
- This branch edits no screen, B1 search/AI/pipeline code, shared contract or new dependency. Its schema extends the foundation's provider-identity migration.

## Complete provider setup (do only before authorized live acceptance)

1. In Google Cloud Console, select/create the Lanyard project. Open Google Auth Platform and fill out Branding with the app name and support/developer contacts. Use the actual deployed homepage/domain for your app. Follow the console's Audience settings for external pilot users; if in testing, add the Google accounts used for the checklist as test users.
2. In Clients, create an OAuth client of type Web application. Give the local client a recognizable name such as Lanyard Local. Add the exact redirect `http://localhost:3000/api/auth/callback/google`. For deployment, use a separate web client and the exact `<your-production-origin>/api/auth/callback/google`; replace the placeholder with the HTTPS origin from Vercel. Arbitrary preview domains will not work unless their exact callbacks are registered.
3. The app requests only `openid profile`. Do not add Gmail, Drive, email or offline-access permissions for this feature. No Google API key or service account is used.
4. Copy that client's Client ID and Client Secret privately into the matching environment as `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`. Keep the existing `AUTH_SECRET`, GitHub credentials and database/search configuration. Do not change or share the existing secret. A Google token must never be placed in a GitHub variable.
5. Keep separate existing local/production GitHub OAuth apps. Their callback stays `/api/auth/callback/github`; the new internal connection URL is not a new OAuth callback. No new GitHub scopes are needed.
**Migration hold:** #47/#50 and the foundation currently collide at 0005. Do not apply them now. Each later branch must merge the schema/snapshot chain and regenerate its migration, retaining backfills; renaming files alone is not valid. Authentication's following attempt migration must be regenerated against that final chain too.

6. Once that order is settled and the migrations are regenerated/reviewed, review outstanding migrations. Foundation migration 0005 makes handles nullable and backfills provider ownership; this branch adds 0006, the attempt table. Apply only to the intended approved Neon target, preserving shared data. From this worktree, the explicit command is:

~~~powershell
node --env-file="D:\Projects\Convo\.env.local" .\node_modules\drizzle-kit\bin.cjs migrate
~~~

7. After the feature is fully integrated and accepted, Person B sets the Google values in Vercel and redeploys. Keep `PROFILE_ENRICHMENT_ENABLED=0` in production until then. Turning the flag off hides Google sign-in again; after Google accounts are released, do not use that as a rollback without an account-access plan.

The callback/variable setup follows [Auth.js Google setup](https://authjs.dev/getting-started/providers/google); credential and branding instructions follow [Google's OIDC setup](https://developers.google.com/identity/openid-connect/openid-connect). The implementation reuses installed Auth.js rather than implementing provider verification itself.

## Complete manual acceptance checklist (live; not yet run)

Prerequisites: nullable-screen/foundation/auth changes are integrated, the intended test Neon database has both migrations, and the local Google/GitHub callbacks/credentials above are configured. Use a dedicated pilot/test database and Google plus two GitHub accounts. A GitHub already used by an existing Lanyard user must be refused as a connection, so use an unused GitHub for the success case. Ask before any agent runs this against providers.

Start locally from this checkout, at the port registered in both clients:

~~~powershell
$env:FAKE_API = "0"
$env:FAKES = "search,ai"
$env:PROFILE_ENRICHMENT_ENABLED = "1"
node --env-file="D:\Projects\Convo\.env.local" .\node_modules\next\dist\bin\next dev --port 3000 --webpack
~~~

This uses live authentication/Postgres and recorded search/AI. Do not use fake `x-demo-user` headers to test real ownership. Until Claude's buttons land, the built-in `/api/auth/signin?callbackUrl=/signin/sources` can start either normal provider sign-in.

1. Signed out: GET `/api/profile-enrichment` returns 401/sign_in_required. Page two itself renders sign-in options. Directly opening `/api/auth/connect/github` does not authorize or connect anything.
2. Google-only: authenticate with Google. GET owner state shows `signIn.provider="google"`, no connected GitHub and `onboarded=false`; the account has no invented handle. `/api/me` returns 409 until onboarding is completed. Check `/api/auth/session`: no provider credentials, email or picture.
3. Connection success: record the session user ID. From that same origin run:

~~~js
var before = await (await fetch('/api/auth/session')).json();
var response = await fetch('/api/profile-enrichment/github/connect', {
  method: 'POST', headers: {'Content-Type':'application/json'}, body: '{}'
});
var result = await response.json();
if (response.status !== 200 || result.status !== 'redirect') throw new Error(JSON.stringify(result));
sessionStorage.setItem('lanyard.auth-test.owner', before.user.id);
location.assign(result.path);
~~~

Authorize an unused GitHub. Expected: returns to page two; session user ID equals the stored owner; owner state still says Google sign-in, now with the actual connected GitHub login. No repository/organisation/evidence import happened. Sign out through `/api/auth/signout`, sign in with this connected GitHub, and confirm the same owner ID and saved profile.
4. Existing GitHub profile: use another browser/profile to sign into the previously used GitHub account. Verify its existing user ID, text, badge, visibility, availability and evidence remain. From the Google owner, attempt to connect that GitHub. Expected `github_linked_elsewhere`, unchanged owner/session, and neither profile is merged or reassigned.
5. Cancellation: cancel Google/GitHub normal authentication and GitHub connection separately. Expected fixed cancellation code and return to page two; cancellation of a connection retains the original session. Retry with a fresh connection succeeds.
6. Session isolation: start a connection, then sign out or switch the Lanyard account in another tab before completing it. Expected rejection, with no provider attached to the wrong owner. A used callback cannot be reused; waiting more than ten minutes requires a new connection attempt.
7. Consent isolation: sign into GitHub with optional imports off. Compare stored GitHub evidence/bio before and after; existing saved evidence is preserved, and no new repository/org import occurs. A handle rename refreshes only the connected handle/revision, preserving edits. Search failure cannot lock the user out.
8. As a final read-only check, verify no duplicate `(provider, provider_account_id)` or `(user_id, provider)` rows exist. Inspect the attempt table: only IDs, hashes, expiry and consumed timestamps, with no provider token or imported text. Review logs for generic messages only.

Cleanup: sign out test browsers, stop the local server and close/reset its task terminal so the feature switches do not carry into other work. Do not delete shared users/requests or reset Neon. Test accounts and provider grants can be removed manually only after confirming they are disposable; expired attempt metadata is cleaned on subsequent connection starts. Leave production feature settings unchanged.

Full enrichment/source approval, extraction, cleanup scheduling and browser acceptance remain on the feature checklist. A passing mocked callback does not prove live provider configuration or database execution.
## Local verification (7 November)

Two critical review/test rounds were completed. Review fixed concurrent sign-up visibility, distinct handling of a second conflicting connection, sanitized outage/cancellation returns, and redirect cache control. The final integrated run passes lint, typecheck and **766 tests in 55 files, with 98.50% line coverage**. Drizzle's local migration check passes. The integration checkout combines this branch with the nullable-screen patch; those screen changes are not included in this backend branch. Its screen tree is identical to Claude's newly pushed `6924256` compatibility commit. Without that dependency, this branch still reports the foundation's five existing nullable-screen type errors.

Tests use recorded provider/Neon replies. One test drives the actual installed Auth.js GitHub authorization/callback and decrypts its resulting test session to verify the linked owner; another verifies Google's authorization URL has only the intended scopes and state/PKCE/nonce. Lost cookies, changed sessions, expired/replayed attempts, ownership conflicts, legacy authentication, callback denial, private session output and service failures are covered. SQL guards are checked through Drizzle with recorded database responses; database execution/concurrency still needs the authorized live checklist above.

A local Next HTTP smoke check confirms both configured providers appear, no test secret appears in provider metadata, anonymous real sessions remain null, the real connection entry point stays unavailable under FAKE_API, and the Google-only fake owner retains a null handle. No external provider, paid call, real database or Vercel setting was used. No new browser-screen acceptance or production build is claimed.

The backend is ready for code review, not merge/deployment. Foundation/compatibility merges, Claude's contract ACK, current PR checks and explicit user PR approval remain outstanding. All source import/job/approval services remain the next implementation phase.
## Coordination update

The feature remains five pages and four independent import sources with Google/GitHub sign-in. Codex owns sign-in, linking, backend and contracts; Claude owns screens and B1. #47/#48 do not change this design. #49 makes neutral approved-evidence titles necessary; B1 search changes start after #49. #50 supplies the badge/avatar base for pages 3-4, whose nullable-handle checks must be retained. Nullable compatibility still lands before the foundation; prefer #47/#50 migrations first, then regenerate the foundation and authentication migrations. No database change has been applied.
Revision verification: the agreed shared return path/reason handling and mandatory single-use entry token pass both full review/test rounds with **776 tests in 55 files, 98.51% line coverage**, lint and typecheck. Validation includes `6924256` in an unpublished checkout; nullable screens remain a merge dependency. The installed Auth.js callback test now covers refusal as well as success, ensuring its redirect callback preserves the agreed refusal reason without issuing a replacement session. Bare/missing/forged/replayed entry tokens do not initiate OAuth. The local recorded-fake HTTP walkthrough passes. No live providers, SQL execution or production settings were touched; migrations remain held for regeneration after #47/#50.
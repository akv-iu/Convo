# GitHub consent enforcement

This B2 change consumes the cookie written by A1 PR #8. It does not change
frontend code, shared API contracts, environment variables, dependencies, or
the database schema. No migration or reset is required.

## A1/B2 handshake

A1 sets `convo_consent` before redirecting to GitHub. Its value is a
comma-separated list of the exact IDs `profile`, `repos`, and `orgs`; an empty
value means all optional sources were declined. A1 already writes an httpOnly,
SameSite=Lax cookie at `/`, secure in production. The backend reads the cookie
from the current OAuth callback request, never from module-level state.

- `profile`: use the public bio in the initial profile.
- `repos`: request owned public repositories and derive languages/evidence.
- `orgs`: request public organisation memberships.
- Missing/empty/unknown-only consent: basic identity only; no repo/org requests.
  Unknown IDs grant nothing. Valid IDs in a mixed value still work.
- Declined repo/org requests are skipped, not fetched then discarded. GitHub's
  identity response itself can contain bio and other fields; unselected bio is
  not used by the importer. Other unused fields are stripped from that response.
- The basic OAuth identity uses GitHub ID, login, name and avatar. The GitHub
  provider requests an explicit empty scope and overrides the default identity
  handler so it never calls `/user/emails`. Email is not copied into sessions;
  old JWT email fields are removed when the session is refreshed.
- Identity validation still runs when everything is declined. If reading consent
  fails, real sign-in is denied before import. Fake mode reads no cookies and
  performs no GitHub or database work.

GitHub documents that public information needs no extra OAuth scope:
[Scopes for OAuth apps](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps).
Existing GitHub authorizations may still have older grants; changing the requested
scope does not itself revoke historical grants. Application enforcement skips
unselected endpoints even if an existing token has broader permission.

## Existing profiles and boundaries

This controls the current import; it is not an account-data deletion feature.
Repeat sign-in still updates only login and revision. Existing bio, languages,
organisations, manual edits, onboarding and availability are preserved. Selecting
more sources later does not automatically overwrite or refill an existing profile.
Users can edit their profile through the existing profile API/screens.

New users without optional consent get empty bio/languages/organisations. Their
filters remain null until onboarding; `/api/me` returning 409 then is expected.
No optional sources are imported through the built-in `/api/auth/signin` page
unless a previously saved consent cookie is present.

Consent is a browser preference used at sign-in, not a durable consent audit or
a policy for future background jobs. Those jobs must define their consent storage
before being added. A1's copy should describe importing selected sources, preserve
the distinction between identity and optional fields, and avoid promising that
unchecking a source deletes previously saved profile content.

PR #8's folder-ownership exceptions and Vercel contributor access are separate
review items. This PR does not approve them or merge the frontend branch.

## Automated verification

Tests use recorded synthetic GitHub fixtures and mocked Neon. They cover all
eight consent combinations, exact endpoints called, initial saved fields,
preservation of existing edits, unknown/missing cookies, isolation between sign-ins,
identity checks, failures, email stripping, and the real Auth.js authorization URL
with an empty scope and its default PKCE protection. No live services are tested.

## Complete manual check

The prepared local integration checkout combines this backend with A1's screen
for testing only. It is not a push to the contributor's branch or a merge to main.
Use your existing local GitHub/Neon credentials. Search and AI remain fake.

1. Stop the old server with Ctrl+C. In PowerShell:

   ```powershell
   cd D:\Projects\convo-consent-check
   Copy-Item "D:\Projects\Convo\.env.local" ".env.local"
   $env:FAKE_API = "0"
   $env:FAKES = "search,ai"
   npm run dev -- --port 3000
   ```

2. Before signing in, record the existing profile fields from the same Neon
   database, using your GitHub login. Do not delete or reset anything:

   ```sql
   SELECT id, github_login, name, bio, languages, organisations,
          filters, free_times, revision
   FROM users
   WHERE github_login = 'YOUR_GITHUB_LOGIN';
   ```

   Keep the results private for comparison. No row means this is a new account;
   one row means existing fields should remain unchanged throughout these checks.

3. Open `http://localhost:3000/signin`. Uncheck all three optional sources and
   click Continue with GitHub. Complete GitHub sign-in. Expect `/onboarding`.
   Its placeholder is A1's current screen, not a backend failure.

   In F12 > Console:

   ```javascript
   var session = await (await fetch('/api/auth/session')).json();
   if (!session.user?.id?.startsWith('github:')) throw new Error('Sign-in failed');
   if (session.user.email || JSON.stringify(session).includes('githubToken')) {
     throw new Error('Unexpected email or token in session');
   }
   console.log('PASS: signed in with a stable ID and no email/token exposed');
   ```

   In F12 > Application > Cookies > localhost, inspect only `convo_consent`:
   expect an empty value, Path `/`, and HttpOnly checked. Do not share session
   cookie values. Re-run step 2's SQL: a new row must have empty bio, `[]` languages,
   `[]` organisations and null filters. An existing row must preserve its saved
   profile/onboarding/availability, with revision increased.

4. Sign out at `http://localhost:3000/api/auth/signout` and click confirmation.
   Stay signed out while verifying:

   ```javascript
   var response = await fetch('/api/me');
   if (response.status !== 401) throw new Error('Stop: still signed in');
   console.log('PASS: signed out');
   ```

   Then visit `/signin` again and leave only **repositories and languages**
   checked. Continue with GitHub. Expect success and `convo_consent = repos`.
   Repeat the session check from step 3. Saved profile edits must remain unchanged.
   Optional endpoint suppression is covered by automated tests: browser Network
   tools cannot show the server's GitHub requests.

5. Sign out and confirm again. Visit `/signin`, leave all three sources checked,
   and sign in. Expect cookie value `profile,repos,orgs` (DevTools may show commas
   encoded as `%2C`), success, and the same stable ID. Re-run the SQL: still one
   row and unchanged existing fields. This does not refill a profile created in
   step 3 with no consent; preservation on repeat sign-in is intentional.

6. Test the missing-cookie path. Sign out and confirm; in Application > Cookies,
   delete only `convo_consent`. Open `/api/auth/signin` directly and sign in with
   GitHub. Expect success without a consent cookie, the same stable ID, and no
   changes to saved profile fields. Do not visit `/signin` and submit its form in
   this step, since that would create a new consent cookie.

7. Cleanup: sign out and confirm. Verify `/api/me` returns 401 using step 4's
   snippet. Delete the test `convo_consent` cookie if present; keep your user row.
   Stop the server with Ctrl+C, then set `$env:FAKE_API = "1"` in PowerShell.
   No production settings need to change. Report all steps together and whether
   you used an existing account or a fresh test account.

With an existing account, these live checks prove OAuth/cookie compatibility and
preservation; automated tests prove which optional endpoints and fields are used.
They do not prove deletion of historical imported data, which is outside this change.

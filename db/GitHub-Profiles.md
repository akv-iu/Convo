# GitHub profiles

Real GitHub sign-in (`FAKE_API` off) imports public profile fields and saves a
user before Auth.js accepts the sign-in. The ID is `github:<numeric account ID>`,
so separate sign-ins and GitHub login renames keep the same database identity.
Sessions issued before this change need a fresh sign-in to receive that ID.

`src/server/profile/github.ts` validates the OAuth identity and GitHub responses. It requests public
repository and organisation endpoints in parallel, with a ten-second timeout
per request and no caching or redirects. Private repositories are excluded.
Only the latest 100 owned public repositories and first 100 public organisations
are imported; the builder selects up to 20 repositories by star count as evidence.
Languages come from the returned repositories' primary languages.

`src/server/profile/persistence.ts` inserts the initial fields into `users`. On repeat sign-in, it
only refreshes `github_login`; saved profile edits, onboarding filters and free
times survive. There is no automatic refresh of the user's editable fields.
Import or database failures deny sign-in rather than creating a partial profile.
Errors logged by the sign-in callback do not include provider or database details.

The OAuth provider uses its default read scopes, without `public_repo` write
access. Its access token stays in Auth.js's encrypted JWT for later server-side
use. The session response and profile database writes do not contain it.

## Boundaries with A1 and B1

- A1 owns the GitHub consent screen; obtain consent before starting GitHub sign-in.
- `FAKE_API=1` skips profile import and database writes, including during OAuth.
  A's screens continue to use the existing demo identities and fake API.
- This step builds repository `EvidenceDoc`s but does not persist or index them.
  Search ingestion joins at C2 after onboarding provides the required filters.
- New rows have `filters = null` and empty free times. No country or workplace is
  guessed. Real `/api/me` and onboarding handlers are a subsequent B2 step.

## Verification

`npm test -- src/server/profile` exercises three saved, synthetic GitHub response
fixtures, HTTP failures and validation, the SQL emitted by the real Drizzle query
builder against a mocked database driver, and the Auth.js callbacks. Tests never
contact GitHub, Neon, Elasticsearch or OpenAI. The synthetic fixtures are not
recordings of real people's accounts.

For a manual real-service check, use this branch locally with `FAKE_API=0`,
`FAKES=search,ai`, the local OAuth app credentials and the configured Neon database.
Keep production and A's environment in fake mode until the real API is ready.
Local settings must not be committed.

1. Start the app and use `/api/auth/signin` to sign in with GitHub.
2. Check `/api/auth/session`: `user.id` must be `github:<your GitHub numeric ID>`;
   the response must not expose the access token.
3. In Neon's SQL editor, find that ID in `users` and inspect the public profile
   fields. A new user has null filters and empty free times.
4. Sign out and back in. The ID must stay the same and there must be only one row
   for that ID. Existing edited fields should remain unchanged.

The built-in Auth.js sign-in page is a developer check; user-facing consent and
onboarding belong to A1. A successful sign-in does not yet prove real matching
or profile-editing routes work.

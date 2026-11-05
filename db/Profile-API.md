# Profile and availability API

With `FAKE_API=0`, the existing GET/PUT `/api/me` and GET/PUT `/api/availability`
routes read and update the signed-in user's Neon row. Apply migration
`0001_profile_revision.sql` before running these routes with the real database.
Use `FAKES=search,ai` until B1's Elasticsearch adapter is ready. Production and
A's environment stay in fake mode during this step.

## Handoff to A1

1. Sign in with GitHub to create the profile row.
2. Save onboarding answers with `PUT /api/me` and a complete `filters` object:
   `country` (two-letter country code), `rorId` (workplace ROR ID or null), and
   `hiring` (boolean). The response is the complete profile, including imported
   GitHub fields. Before this save, GET `/api/me` returns 409 with an onboarding
   message because the shared Person contract requires these answers.
3. GET `/api/me` reads the profile; subsequent PUTs send only the fields edited.
   Caller-supplied `id` and `synthetic` values are ignored by the existing schema.
4. GET `/api/availability` reads free times. PUT replaces the whole list; `[]`
   clears it. Availability may be saved before onboarding. Both availability
   write paths reject intervals whose end is not later than their start.

Errors use the existing `{ error }` envelope: 401 for no session, 404 for a
missing user, 400 for invalid input, and 503 for storage or search failures.
Keep handling 409 before trying to render a complete profile. Contracts and the
fake API have not changed; A must account for this real onboarding state at C2.

## Search boundary

Saving a complete profile or its availability calls
`ingestPerson(person, undefined, revision)`.
Omitted evidence preserves existing repository evidence; an explicit `[]`
clears it. Each database write atomically increments the user's revision,
including GitHub login refreshes. Search ignores older revisions and unversioned
writes after a versioned save; equal revisions can retry. The revision stays
internal and is not part of the frontend Person contract. B1's real adapter must
implement the same evidence semantics and atomic revision check. This step
does not ingest the repositories built during sign-in; that connection remains
for C2. The in-memory search index is temporary and resets when the process does.

Postgres is saved before search. If indexing fails, the response explicitly
says the profile was saved and asks the caller to retry the same save. There is
no transaction across the two services or background retry. Revisions prevent
an older successful save from overwriting newer indexed data; they do not
automatically repair an index write that fails. Keep using the in-memory adapter
until B1 implements and verifies these rules in Elasticsearch.

## Manual local check

This check writes to your configured Neon database. Keep keys out of terminals,
screenshots and commits. Stop the previous local dev server if it occupies 3000.
From PowerShell:

```powershell
cd D:\Projects\convo-b2-profile-api
Copy-Item "D:\Projects\Convo\.env.local" ".env.local"
node --env-file=.env.local ./node_modules/drizzle-kit/bin.cjs migrate
$env:FAKE_API = "0"
$env:FAKES = "search,ai"
npm run dev -- --port 3000
```

The migration adds one non-null integer column with default zero; it drops
nothing. The CLI command loads the env file explicitly. Next loads `.env.local`
itself; do not start Next with Node's `--env-file` flag. Check for an existing
shell `DATABASE_URL` override before running the migration (see [database
instructions](README.md)).
Sign in at `http://localhost:3000/api/auth/signin`, then use that same browser's
developer console. These calls use your signed-in session:

```javascript
async function api(path, body) {
  const response = await fetch(`/api/${path}`, body === undefined ? {} : {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}
var original = await api("me");
var originalTimes = await api("availability");
console.log(original, originalTimes);
```

1. A new user should get 409 for `me` and 200 for availability. An already
   onboarded user should get 200 for both.
2. If needed, save your actual answers (replace the example country and hiring
   answer): `await api("me", { filters: { country: "US", rorId: null, hiring: false } })`.
   Expect 200, your `github:` ID, and `synthetic: false`.
3. Save a test bio using `await api("me", { bio: "Temporary profile API check" })`.
   Read `await api("me")` and verify it persisted and other fields survived.
4. Save `await api("availability", [{ start: "2026-11-09T16:00:00Z", end: "2026-11-09T17:00:00Z" }])`.
   Read availability and `/api/me`; both must contain the same interval.
5. Reverse those start/end values and repeat the save. Expect 400; GET must
   still show the previous valid interval. Save `[]` and verify both reads clear.
6. Restart the app and sign in again. Profile edits and cleared availability
   must survive. In Neon's SQL editor, verify the same user's `bio`, `filters`
   and `free_times` agree with the API.
7. Restore the original bio and times if desired. For a previously onboarded
   user, use the captured `original.body.bio`; for a new user, copy the bio from
   step 2 before editing it. The new onboarding answers remain saved.
8. Sign out and confirm both endpoints return 401. Stop the server and restore
   `$env:FAKE_API = "1"` in that terminal when returning to fake mode.

## Automated checks

`npm run lint`, `npm run typecheck`, and `npm test` exercise the four actual
HTTP handlers in fake and real mode, the Drizzle SQL through a mocked Neon
driver, failure handling, invalid intervals, preservation of search evidence,
and a delayed older database response arriving after a newer save was indexed.
All service calls are local fakes or mocks; no automated test contacts live
GitHub, Neon, Elasticsearch or OpenAI. No screens changed in this step.

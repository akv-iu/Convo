# GitHub evidence: B2 implementation and B1 handoff

Branch: `b2/github-evidence`, based on `main` at `9238095`. Claude owns
`b1/elastic-search`; Person A owns the screens. No shared API contract or B1 file
changes are needed for this work.

## What changes

`users.github_evidence` holds the existing builder's snapshot of up to 20 public
repository evidence documents. The existing loader reads up to 100 public repos;
the builder selects the 20 most starred. This is deterministic import, not AI
extraction. Tokens and raw GitHub responses are not stored in this column.

- First sign-in saves evidence before onboarding. A complete profile is indexed
  after onboarding supplies filters, or immediately on a subsequent sign-in.
- Each sign-in replaces imported evidence. Deleted/private repos disappear on
  the next successful refresh. Missing or unchecked repo consent writes `[]`.
- User-edited name, biography, languages, organisations, workplace, colour,
  visibility and availability are preserved on subsequent sign-ins. Clearing
  imported evidence does not erase these editable profile fields.
- Profile and availability saves replay the evidence from the returned database
  row, together with that row's revision. `PUT /api/me` with `{}` repairs search
  without editing profile fields or fetching GitHub again.
- Neither evidence storage nor its pending flag is exposed in `GET/PUT /api/me`.
  Clients cannot write these fields through the API.

`users.github_evidence_pending` is set during import. Until search confirms the
saved snapshot, matching excludes that person before search/explanations and
checks the flag again before returning cards. This prevents a failed refresh or
consent removal from showing old repository highlights. Acknowledgement is
conditional on the user's revision, so an older response cannot confirm a newer
import. Changes are ordered by committed database revision.

There is no background retry worker. On failure, the API returns a sanitized 503
explaining that the profile was saved and the same save/sign-in can be retried.
Auth.js still displays its generic denied-sign-in page when initialization fails;
the database save remains durable, and retrying sign-in is safe. An existing
signed-in session can instead retry `PUT /api/me` with `{}`. Pending profiles stay
out of match cards until synchronization succeeds.

## Interface for Claude's Elasticsearch work

The existing signature is unchanged:

```ts
ingestPerson(person: Person, evidence?: EvidenceDoc[], revision?: number): Promise<void>
```

B2 now supplies a complete repository evidence snapshot and a revision for real
profiles. B1 must preserve the existing semantics:

1. An array replaces evidence, including `[]` to remove all previous evidence.
   Omitted evidence remains supported for other callers and preserves it.
2. Ignore older revisions for both person metadata and evidence. Equal revisions
   may replay a write to repair a failed synchronization.
3. Resolve only when the entire update is confirmed; surface partial bulk
   failures. Old evidence must no longer be searchable when replacement is
   acknowledged, including Elasticsearch refresh visibility. An older writer
   must not delete or replace evidence belonging to a newer revision.
4. Honour `SearchFilters.excludeIds` before returning candidates. B2 uses it for
   pending imports as well as requesters and rejected people.

The new Postgres flag belongs to B2. B1 should not add columns, change the shared
contracts or modify B2's profile services for this task. Integration tests against
real Elasticsearch remain a separate, explicitly approved step after both branches
are combined. This branch uses `FAKES=search,ai` for the manual checks below.

## Complete manual checklist

No live test or migration has been run by the agent. The tests below contact
GitHub/Neon when **you** run them. Use an account with at least one public repo to
check nonempty evidence. An account with no public repos should legitimately save
`[]`; it cannot demonstrate repository search results.

### 1. Apply the additive migration and start the right worktree

Stop the previous local server. In a fresh PowerShell terminal:

```powershell
cd D:\Projects\convo-b2-github-evidence
node --env-file="D:\Projects\Convo\.env.local" .\node_modules\drizzle-kit\bin.cjs migrate
Copy-Item -LiteralPath D:\Projects\Convo\.env.local -Destination .env.local
$env:FAKE_API = "0"
$env:FAKES = "search,ai"
npm run dev -- --port 3000
```

The migration adds `github_evidence` and `github_evidence_pending`; it drops
nothing. Apply it before deploying these handlers. If Node reports that
`--env-file` is forbidden in `NODE_OPTIONS`, remove that invalid option from this
terminal's `NODE_OPTIONS` and retry. Do not put `--env-file` inside `NODE_OPTIONS`.

### 2. Save the original consent choice and import repositories

Open `http://localhost:3000`. In its DevTools console:

```js
if (sessionStorage.getItem("convo.evidence-test")) throw new Error("Finish/restore the earlier test first");
var oldConsent = document.cookie.split("; ").find(c => c.startsWith("convo_consent="))?.slice("convo_consent=".length) ?? null;
sessionStorage.setItem("convo.evidence-test", JSON.stringify({oldConsent}));
document.cookie = "convo_consent=profile,repos,orgs; Path=/; SameSite=Lax";
location.href = "/api/auth/signin";
```

Sign in with GitHub as account A. If already signed in, sign out at
`/api/auth/signout` first, then use `/api/auth/signin`. Complete onboarding at
`/onboarding` if `GET /api/me` returns 409. Keep this same browser tab for backups.

Then run:

```js
var r = await fetch("/api/me");
var me = await r.json();
if (r.status !== 200) throw new Error(JSON.stringify(me));
if ("githubEvidence" in me || "githubEvidencePending" in me) throw new Error("Internal storage exposed");
var test = JSON.parse(sessionStorage.getItem("convo.evidence-test"));
test.owner = me.id;
test.profile = me;
sessionStorage.setItem("convo.evidence-test", JSON.stringify(test));
console.log("Account A:", me.id, me.githubLogin);
```

### 3. Check durable storage in Neon

In the Neon SQL editor for the database configured in your local environment,
replace `YOUR_GITHUB_LOGIN` with the login printed above and run this read-only SQL:

```sql
SELECT id, github_login, revision, github_evidence_pending,
       jsonb_array_length(github_evidence) AS repo_count,
       github_evidence
FROM users
WHERE github_login = 'YOUR_GITHUB_LOGIN';
```

Expected: `repo_count` is 0–20, the documents contain only public repositories,
every `personId` is A's ID, and `github_evidence_pending` is false after onboarding.
No token, email or private repo should appear. Record one returned repo `title`
for the optional two-account search check in step 5.

### 4. Restart, replay and verify that profile edits remain unchanged

Stop and restart this same server using the same commands/settings. Reload A's
tab. This clears fake search, but not Neon. Paste the entire block:

```js
var test = JSON.parse(sessionStorage.getItem("convo.evidence-test"));
var r = await fetch("/api/me");
var current = await r.json();
if (!r.ok || current.id !== test.owner) throw new Error("Sign in as A");
var r = await fetch("/api/me", {method:"PUT", headers:{"Content-Type":"application/json"}, body:"{}"});
var replayed = await r.json();
if (!r.ok) throw new Error(JSON.stringify(replayed));
if (JSON.stringify(replayed) !== JSON.stringify(test.profile)) throw new Error("Profile choices changed");
console.log("PERSISTENCE AND REPLAY PASSED");
```

Rerun the SQL from step 3: the same repository snapshot must remain saved.
Console functions do not survive reload; every block here is self-contained.

### 5. Optional two-account proof that evidence reaches search

Use a different GitHub account B in an incognito window on the same localhost
server. Complete onboarding there. In B's console, replace both placeholders:

```js
if (sessionStorage.getItem("convo.evidence-ask")) throw new Error("Resolve the previous test ask first");
var aId = "PASTE_ACCOUNT_A_ID";
var title = "PASTE_REPO_TITLE_FROM_STEP_3";
var r = await fetch("/api/me");
var b = await r.json();
if (!r.ok || b.id === aId || aId === "PASTE_ACCOUNT_A_ID" || title.startsWith("PASTE_")) throw new Error("Use account B and replace the placeholders");
var r = await fetch("/api/refine", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({text:title + " repository"})});
var created = await r.json();
if (!r.ok) throw new Error(JSON.stringify(created));
sessionStorage.setItem("convo.evidence-ask", JSON.stringify({owner:b.id, aId, askId:created.askId, title}));
var r = await fetch("/api/match", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({askId:created.askId})});
var cards = await r.json();
if (!r.ok) throw new Error(JSON.stringify(cards));
var card = cards.find(c => c.person.id === aId);
if (!card || !card.highlights.includes(title)) throw new Error("Expected A's saved repository evidence");
console.log("REPOSITORY SEARCH PASSED", card);
```

### 6. Re-sign in without repository consent

In A's original tab:

```js
document.cookie = "convo_consent=profile,orgs; Path=/; SameSite=Lax";
location.href = "/api/auth/signout";
```

Confirm sign-out, then visit `/api/auth/signin` and sign in as A again. Run:

```js
var test = JSON.parse(sessionStorage.getItem("convo.evidence-test"));
var r = await fetch("/api/me");
var current = await r.json();
if (!r.ok || JSON.stringify(current) !== JSON.stringify(test.profile)) throw new Error("Saved profile choices changed");
console.log("REPEATED SIGN-IN PRESERVES EDITS");
```

Rerun step 3 SQL. Expected: `github_evidence = []`, `repo_count = 0`, pending false.
If you ran step 5, run this in B's window too:

```js
var test = JSON.parse(sessionStorage.getItem("convo.evidence-ask"));
var r = await fetch("/api/match", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({askId:test.askId})});
var cards = await r.json();
if (!r.ok) throw new Error(JSON.stringify(cards));
var card = cards.find(c => c.person.id === test.aId);
if (card && card.highlights.length) throw new Error("Removed repository evidence still appears");
console.log("REPOSITORY EVIDENCE REMOVED");
```

A may still match through an edited biography or organisation; those fields were
not erased. The check concerns the imported repository evidence.

### 7. Restore consent and clean up

In A's window, restore the original cookie and re-sign in so stored evidence
matches the restored choice. If the original cookie was missing, restoring it
means no repository import. To deliberately keep repo import enabled, use the
normal sign-in screen's consent controls after finishing this checklist.

```js
var test = JSON.parse(sessionStorage.getItem("convo.evidence-test"));
if (!test) throw new Error("Missing backup");
document.cookie = test.oldConsent === null
  ? "convo_consent=; Max-Age=0; Path=/; SameSite=Lax"
  : `convo_consent=${test.oldConsent}; Path=/; SameSite=Lax`;
location.href = "/api/auth/signout";
```

Confirm sign-out and sign back in through `/api/auth/signin`. Then:

```js
var test = JSON.parse(sessionStorage.getItem("convo.evidence-test"));
var r = await fetch("/api/me");
var current = await r.json();
if (!r.ok || current.id !== test.owner || JSON.stringify(current) !== JSON.stringify(test.profile)) throw new Error("Restore check failed; keep the backup");
sessionStorage.removeItem("convo.evidence-test");
console.log("CONSENT RESTORED; PROFILE UNCHANGED");
```

If you created B's test ask, resolve it while still signed in as B:

```js
var test = JSON.parse(sessionStorage.getItem("convo.evidence-ask"));
var r = await fetch("/api/me");
var current = await r.json();
if (!r.ok || !test || current.id !== test.owner) throw new Error("Sign in as B first");
var r = await fetch(`/api/asks/${test.askId}/resolve`, {method:"POST"});
var resolved = await r.json();
if (!r.ok || resolved.status !== "resolved") throw new Error("Cleanup failed; keep the ask ID");
sessionStorage.removeItem("convo.evidence-ask");
console.log("TEST ASK RESOLVED");
```

The resolved ask stays in Neon as history. Session-storage cleanup never deletes
database rows. If a test stops early, keep its backups and use step 7 to restore.

### Failures covered automatically

Mocked tests exercise GitHub/storage/search failures, failed acknowledgements,
foreign/corrupt evidence, consent removal, replay without GitHub, and an older
save finishing after evidence was cleared. Do not break live credentials or edit
database rows to simulate these failures. Live Elasticsearch correctness and
latency will be checked separately with Claude's B1 implementation.

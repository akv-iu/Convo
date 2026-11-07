# Saved asks and matching

This B2 step implements the existing POST `/api/refine` and POST `/api/match`
routes. No schema migration, reset, new credential or dependency is required.
Real routes use `FAKE_API=0` and `FAKES=search,ai`: the ask is saved in Neon,
while refinement and matching use B1's canned AI and fixture search engine.
Production stays in fake mode until the integration checkpoint.

## API and frontend handoff

- `/api/refine` accepts `{ text }`, requires a completed profile, validates the
  AI reply, saves the original/refined question under the authenticated user,
  and registers the refined text through B1's search interface. It returns
  `{ askId, refined: { text, type, minutes } }`. Caller-supplied identity fields
  are ignored. Whitespace-only questions return 400. An ask that OpenAI's
  moderation check flags returns 422 with `{ error }`, a message the screen can
  show as it is, and nothing is saved. If the check itself is unavailable, the
  ask gets the usual retryable 503 and nothing is saved. With `FAKE_API=1` or `FAKES=ai`, any ask
  containing the word "idiot" gets the same 422, for building that screen.
- Each refinement submission creates a new ask. Keep its ID for subsequent
  matching requests. Disable duplicate submissions while a save is pending.
- **New-ask defaults.** Every new ask suggests a 5-minute chat, whatever its
  type (`MEETING_MINUTES` in `src/server/ai/minutes.ts`, used by the OpenAI and
  canned refinement). New asks start with the soft blocker ("Keep people I pass
  on hidden") **off**: the insert sets `soft_blocker = false` explicitly, and
  migration `0005_new_ask_defaults` makes `false` the column default as well. Asks saved before
  this keep their length and their switch. With the switch off, a person passed
  on stays in the matches; the batch cutoff after three passes still applies.
- After `/api/refine` responds, the real backend starts that ask's first match
  in the background, as a best effort (about 3.5 s). If it finishes before the
  asker opens the results, `/api/match` reuses its cached AI explanations
  instead of waiting about 3 s for them. If the asker opens the results first,
  both requests explain the same cards: the lines are the same, but OpenAI is
  paid twice. Whether this meets the 2-second p95 is measured in Dash0.
  **Screens:** call `/api/match` when the asker continues from the refined
  question, not automatically when `/api/refine` returns. Don't add a delay.
- `/api/match` accepts `{ askId, query? }`, loads the owned ask and current
  profile, reads its persisted rejections, and calls the existing four-span
  pipeline. Matches conform to the frozen schema, including highlights,
  explanation, rank, badges and mutual-interest flag. The optional query is
  passed to B1's pipeline; it does not modify the saved question.
- Missing asks and asks owned by another user both return 404. Signed-out calls
  return 401. Storage, invalid provider replies and pipeline failures return
  sanitized 503 errors. Failure to load exclusions stops matching.
- The rejection count, cutoff and soft-blocker behavior match the existing fake:
  the configured threshold activates a batch rank cutoff; turning the soft
  blocker off removes this ask's individual exclusions, while the cutoff still
  applies. The real backend additionally excludes attendees whose open,
  blocker-enabled asks reject the signed-in user, regardless of this ask's switch.
  This step only reads these values. Rejection/switch write routes follow in
  the next B2 slice. Resolved-ask behavior also follows the existing fake.
- The shared contract has no endpoint to update an existing refined question.
  Calling `/api/refine` again creates another ask; do not present it as editing
  the old ask. Agree a contract change with both people if in-place editing is
  required.

## Failure and persistence boundaries

Neon commits before search registration. If registration fails, `/api/refine`
still returns its normal successful `{ askId, refined }` response, and the server
logs a fixed warning without provider details. The next `/api/match` replays
registration for an owned, open ask with a saved refinement alongside the
profile, exclusion and pending-user lookups. A failed replay also logs a warning
and does not prevent matching. Registration uses the same ID, so repeated retries
do not create another ask or repeat refinement. Resolved asks are never
re-registered. Storage, refinement and matching failures still report their
normal errors; only registration failures are tolerated.
There is no transaction across Neon and search or request idempotency key.
Recovery requires a matching request; there is no background retry worker.
A database timeout can also leave the commit outcome unknown; the error does
not claim it was rolled back. See [Ask-Recovery.md](Ask-Recovery.md) for the
complete recovery check.

Saved asks survive restarts. Fake search registrations do not. Matching an open,
refined ask restores its registration after a restart. Until that request runs,
reverse counts and mutual flags can still omit the ask.
Real Elasticsearch, OpenAI, reverse counters, rejection writes, requests,
scheduling and resolution are separate steps and are not completed by this PR.

Automated tests run the same HTTP scenarios in fake and real mode with the real
pipeline, canned AI and mocked Neon driver. They verify all three current sample
asks' expected top matches, identity scoping, SQL writes, error handling and
validation. They do not contact GitHub, Neon, OpenAI or Elasticsearch.

## Complete manual check

This uses your local GitHub/Neon configuration and creates one test ask. It does
not call OpenAI or Elasticsearch. Stop and report the step/status if any expected
result differs. Keep the browser tab open until cleanup.

1. Stop the previous local server with Ctrl+C. In PowerShell:

   ```powershell
   cd D:\Projects\convo-b2-asks
   Copy-Item "D:\Projects\Convo\.env.local" ".env.local"
   $env:FAKE_API = "0"
   $env:FAKES = "search,ai"
   npm run dev -- --port 3000
   ```

   No new migration is needed. The previous profile revision migration must
   already be installed, as in your completed profile tests.

2. Open `http://localhost:3000/api/auth/signin` and sign in. In the browser's
   F12 > Console, paste this helper (initial `undefined` is normal). Unlike the
   earlier profile helper, this uses POST for requests with a body:

   ```javascript
   async function api(path, body) {
     const response = await fetch(`/api/${path}`, body === undefined ? {} : {
       method: "POST", headers: { "Content-Type": "application/json" },
       body: JSON.stringify(body),
     });
     const result = { status: response.status, body: await response.json() };
     console.log(result);
     return result;
   }
   var me = await api("me");
   ```

   Expect 200 and your saved profile. A 409 means onboarding is incomplete;
   finish the earlier profile setup first.

3. Create one test ask:

   ```javascript
   var created = await api("refine", {
     text: "I want to understand how preemption works in the Kubernetes scheduler"
   });
   if (created.status !== 200) throw new Error("Stop: ask creation failed");
   sessionStorage.setItem("convo.ask-test.id", created.body.askId);
   sessionStorage.setItem("convo.ask-test.owner", me.body.id);
   ```

   Expect 200, a nonempty `askId`, and a refined question with type `knowledge`
   and `minutes: 5`. The text is deterministic canned AI, not an OpenAI reply.

4. Find matches for that saved ask:

   ```javascript
   var matches = await api("match", {
     askId: sessionStorage.getItem("convo.ask-test.id")
   });
   console.table(matches.body.map(result => ({
     name: result.person.name, id: result.person.id, rank: result.rank,
     explanation: result.explanation
   })));
   ```

   Expect 200 and a nonempty list with profile, evidence highlights, explanation
   and rank. Your own GitHub ID must not appear. These are fixture people; the
   `synthetic` field reflects each fixture and is preserved as supplied.

5. Exercise the optional search text without creating another ask:

   ```javascript
   await api("match", {
     askId: sessionStorage.getItem("convo.ask-test.id"), query: "etcd"
   });
   ```

   Expect 200 and a valid result list. This changes the pipeline's query, not
   the saved ask text. An empty list is a valid response for other queries.

6. Check invalid input and a nonexistent ask:

   ```javascript
   await api("refine", { text: "a" });
   await api("refine", { text: "   " });
   await api("match", {});
   await api("match", { askId: "convo-missing-ask-manual-check" });
   ```

   Expect 400, 400, 400, then 404. Red console lines are expected for these
   deliberate failures. The invalid refinement calls must not create asks.

7. Restart the server: Ctrl+C, then `npm run dev -- --port 3000` in the same
   terminal. In the same browser tab (paste the helper again if needed):

   ```javascript
   await api("match", { askId: sessionStorage.getItem("convo.ask-test.id") });
   ```

   Expect 200 with results using the same stored ask ID. Mutual flags/ranking
   can differ because the fake search index resets; the ask must still load.

8. Optional extra ownership check if you have a second GitHub account: copy the
   test ask ID, sign in as the second account in a separate browser profile, and
   POST to `/api/match` with that ID using the helper. Expect 404. Automated tests
   already cover this check; a second account is not required for this slice.

9. Cleanup only the test ask in the same Neon database's SQL editor. First print
   the two identifiers in your original browser console:

   ```javascript
   console.log({
     askId: sessionStorage.getItem("convo.ask-test.id"),
     userId: sessionStorage.getItem("convo.ask-test.owner")
   });
   ```

   Replace the placeholders below with those exact IDs:

   ```sql
   SELECT id, user_id, raw_text, refined, status, soft_blocker
   FROM asks
   WHERE id = 'PASTE_TEST_ASK_ID' AND user_id = 'PASTE_YOUR_GITHUB_ID';
   ```

   Expect one row with the test question, `status = open`, `soft_blocker = false`,
   and the refined JSON. Then remove that row:

   ```sql
   DELETE FROM asks
   WHERE id = 'PASTE_TEST_ASK_ID' AND user_id = 'PASTE_YOUR_GITHUB_ID'
   RETURNING id;
   ```

   Expect exactly one deleted ID. No other profile, availability or ask is
   changed. A foreign-key error means the ask has dependent records; stop and
   report it rather than deleting other tables. In the browser, repeat the
   match call from step 7 and expect 404. Then remove the tab's saved test IDs:

   ```javascript
   sessionStorage.removeItem("convo.ask-test.id");
   sessionStorage.removeItem("convo.ask-test.owner");
   ```

10. Open `http://localhost:3000/api/auth/signout` and confirm. In its console,
    paste the helper again if necessary. Stay signed out for this entire step.
    The guard below stops the write checks if your session is still active:

    ```javascript
    var signedOut = await api("me");
    if (signedOut.status !== 401) throw new Error("Stop: you are still signed in");
    await api("refine", { text: "scheduler preemption" });
    await api("match", { askId: "signed-out-test" });
    ```

    Both must return 401 with `sign in first`. Stop the server with Ctrl+C and
    restore `$env:FAKE_API = "1"` in PowerShell. Stopping also clears any fake
    search registration left from the test. Report the results for steps 3–10,
    distinguishing the optional second-account test if skipped.

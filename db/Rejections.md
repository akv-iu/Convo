# Saved rejections and soft blocker

This B2 slice implements POST `/api/rejections` and PUT `/api/soft-blocker`.
It uses the existing tables; no migration, reset, dependency or credential change
is needed. Local testing uses `FAKE_API=0`, `FAKES=search,ai`. Neon is real;
search and AI remain fake. Production remains in fake mode until integration.

## Frontend handoff

- Send `{ askId, personId, rank }` to POST `/api/rejections`. Use the candidate's
  returned rank. The response is `{ rejections, hiddenBelowRank }`.
- Send `{ askId, enabled }` to PUT `/api/soft-blocker`. The response echoes the
  saved `{ askId, enabled }`. The update changes only this flag, not rejections.
- Both writes enforce the authenticated owner inside their SQL statement.
  Missing and foreign-owned asks both return 404. Signed-out requests return
  401; malformed bodies return 400; storage failures return sanitized 503.
- Matching and rejection responses share the same exclusion reader. After
  three submissions, the cutoff is the **maximum submitted rank**. Matching
  retains ranks strictly less than that cutoff after filtering and reranking.
- Turning the switch off restores individual candidates but keeps the batch
  cutoff active. Turning it back on reapplies all saved individual exclusions.
  These are the frozen fake's existing semantics, including resolved asks.
- Rejections count submissions, not unique people. Repeating the same POST
  counts again, including after an uncertain network failure. Three submissions
  of rank zero produce cutoff zero and therefore no matches. Disable duplicate
  submissions, serialize saves for an ask, and do not automatically retry POSTs.
- Each rejection is appended rather than replacing an in-memory count. Concurrent
  inserts do not overwrite one another; the following count read reflects its
  database snapshot. Switch updates use the last committed value. Avoid applying
  stale responses from overlapping UI requests.
- If insertion succeeds but reading the count fails, the 503 explicitly says
  the rejection was saved and must not be resubmitted. If insertion itself times
  out, the commit outcome is unknown. Refresh matching before deciding what to do.
  The PUT switch request can safely repeat the same desired value.

No shared contracts, B1 engine code or screens change. The fake does not enforce
reverse-direction blocking; this slice does not add that behavior. Any change
to the above semantics must be agreed with both people through the contract flow.
Request/inbox/response APIs are the next B2 slice; scheduling and resolution follow.

## Complete manual check

Creates one test ask and three rejections. Run each numbered step once, in order.
Stop on any thrown error and report the step and response. Do not repeat a
rejection step: repeating it adds another rejection. Keep the same browser tab.

1. Stop the old server with Ctrl+C, then run in PowerShell:

   ```powershell
   cd D:\Projects\convo-b2-rejections
   Copy-Item "D:\Projects\Convo\.env.local" ".env.local"
   $env:FAKE_API = "0"
   $env:FAKES = "search,ai"
   npm run dev -- --port 3000
   ```

2. Sign in at `http://localhost:3000/api/auth/signin`. In F12 > Console paste
   these helpers. They stop on unexpected statuses and use PUT for the switch.
   Defining them may print `undefined`; that is normal.

   ```javascript
   function check(ok, message) {
     if (!ok) throw new Error(message);
   }
   async function api(path, body, method = body === undefined ? "GET" : "POST", expected = 200) {
     const response = await fetch(`/api/${path}`, {
       method,
       ...(body === undefined ? {} : {
         headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
       })
     });
     const value = await response.json();
     console.log(path, response.status, value);
     check(response.status === expected, `${path}: expected ${expected}, got ${response.status}`);
     return value;
   }
   function saved() {
     const value = JSON.parse(sessionStorage.getItem("convo.rejection-test") || "null");
     check(value, "Missing saved test identifiers");
     return value;
   }
   async function matches() { return api("match", { askId: saved().askId }); }
   async function blocker(enabled) {
     const result = await api("soft-blocker", { askId: saved().askId, enabled }, "PUT");
     check(result.enabled === enabled, "Wrong saved switch value");
   }
   async function rejectAt(index) {
     const test = saved(), candidate = test.picks[index];
     return api("rejections", { askId: test.askId, personId: candidate.id, rank: candidate.rank });
   }
   ```

3. Create the test question once and save its IDs in the tab:

   ```javascript
   check(!sessionStorage.getItem("convo.rejection-test"), "A test already exists; do not create another");
   var me = await api("me");
   var created = await api("refine", { text: "kubernetes scheduling preemption etcd raft argo gitops" });
   sessionStorage.setItem("convo.rejection-test", JSON.stringify({ askId: created.askId, owner: me.id, picks: [] }));
   var original = await matches();
   check(original.length >= 4, "Expected at least four fixture matches");
   sessionStorage.setItem("convo.rejection-test", JSON.stringify({
     ...saved(), picks: original.slice(0, 3).map(x => ({ id: x.person.id, rank: x.rank }))
   }));
   console.log("Saved test", saved());
   ```

   Expect 200 for all three API calls and at least four matches. A 409 on `/me`
   means onboarding is incomplete; do not proceed until the earlier profile setup
   is complete. The guard stops before creating the ask in that case.

4. Reject one candidate and verify both switch directions:

   ```javascript
   var first = await rejectAt(0);
   check(first.rejections === 1 && first.hiddenBelowRank === null, "Wrong first rejection count");
   check(!(await matches()).some(x => x.person.id === saved().picks[0].id), "Rejected person still visible");
   await blocker(false);
   check((await matches()).some(x => x.person.id === saved().picks[0].id), "Switch off did not restore person");
   await blocker(true);
   check(!(await matches()).some(x => x.person.id === saved().picks[0].id), "Switch on did not hide person");
   console.log("PASS: individual rejection and switch");
   ```

5. Reach the batch threshold using the original result ranks:

   ```javascript
   var second = await rejectAt(1);
   check(second.rejections === 2 && second.hiddenBelowRank === null, "Wrong second rejection count");
   var third = await rejectAt(2);
   check(third.rejections === 3 && third.hiddenBelowRank === 2, "Expected count 3 and cutoff 2");
   var afterBatch = await matches();
   check(afterBatch.length > 0 && afterBatch.length <= 2, "Wrong batch size");
   check(afterBatch.every(x => x.rank < 2 && !saved().picks.some(p => p.id === x.person.id)), "Batch exclusions failed");
   console.log("PASS: three rejections and batch cutoff");
   ```

6. Restart the server with Ctrl+C, then `npm run dev -- --port 3000` in the
   same terminal. In the same browser tab, run the following. If the page was
   reloaded, paste only the helpers from step 2 again, not steps 3-5.

   ```javascript
   var restarted = await matches();
   check(restarted.length > 0 && restarted.length <= 2, "Cutoff did not survive restart");
   check(restarted.every(x => x.rank < 2 && !saved().picks.some(p => p.id === x.person.id)), "Rejections did not survive restart");
   await blocker(false);
   var switchedOff = await matches();
   check(switchedOff.length === 2 && switchedOff.every(x => x.rank < 2), "Switch off lost the persisted batch cutoff");
   console.log("PASS: persistence and cutoff with switch off");
   ```

   Exact ranking can change when fake search registrations reset. The persisted
   IDs, exclusions and cutoff must still work. Leave the switch off for step 8.

7. Verify invalid input and nonexistent asks. Red console lines are expected:

   ```javascript
   await api("rejections", { askId: saved().askId, personId: saved().picks[0].id, rank: -1 }, "POST", 400);
   await api("soft-blocker", { askId: saved().askId, enabled: "false" }, "PUT", 400);
   await api("rejections", { askId: "missing-rejection-test", personId: "p1", rank: 0 }, "POST", 404);
   await api("soft-blocker", { askId: "missing-rejection-test", enabled: false }, "PUT", 404);
   console.log("PASS: invalid and missing-ask requests");
   ```

   Optional: in a separate browser profile signed in as a second GitHub account,
   use the test ask ID for either write route. Both must return 404. Automated
   tests cover foreign ownership; a second account is not required for this slice.

8. Cleanup this test only. Run `console.log(saved())` in the original browser.
   In the same Neon database SQL editor, substitute its exact `askId` and `owner`:

   ```sql
   SELECT a.id, a.user_id, a.raw_text, a.soft_blocker, count(r.id) AS rejection_count
   FROM asks a LEFT JOIN rejections r ON r.ask_id = a.id
   WHERE a.id = 'PASTE_TEST_ASK_ID' AND a.user_id = 'PASTE_OWNER_ID'
   GROUP BY a.id;
   ```

   Expect one test ask, `soft_blocker = false`, and `rejection_count = 3`.
   Delete its child rows first. Run this statement by itself:

   ```sql
   DELETE FROM rejections r USING asks a
   WHERE r.ask_id = a.id
     AND a.id = 'PASTE_TEST_ASK_ID' AND a.user_id = 'PASTE_OWNER_ID'
   RETURNING r.id;
   ```

   Expect three returned IDs. Then run this statement by itself:

   ```sql
   DELETE FROM asks
   WHERE id = 'PASTE_TEST_ASK_ID' AND user_id = 'PASTE_OWNER_ID'
   RETURNING id;
   ```

   Expect one returned ID. Refresh the table view if it shows stale rows. Stop
   on a foreign-key error; do not delete other records. Back in the browser:

   ```javascript
   await api("match", { askId: saved().askId }, "POST", 404);
   sessionStorage.removeItem("convo.rejection-test");
   ```

9. Open `http://localhost:3000/api/auth/signout` and click the confirmation.
   **Stay signed out for this entire step.** Paste the helpers from step 2 again
   if necessary, then paste this whole block. Its first line stops the block if
   you are still signed in, before any writes:

   ```javascript
   await api("me", undefined, "GET", 401);
   await api("rejections", { askId: "signed-out-test", personId: "p1", rank: 0 }, "POST", 401);
   await api("soft-blocker", { askId: "signed-out-test", enabled: false }, "PUT", 401);
   console.log("PASS: signed-out access");
   ```

   All three must return 401. Stop the server with Ctrl+C, then restore
   `$env:FAKE_API = "1"` in PowerShell. Report whether all steps passed and whether
   the optional second-account check was skipped. No production settings change.

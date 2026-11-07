# Two-way soft blocker

Branch: `b2/two-way-soft-blocker`, starting from main after PR #25. No migration,
credential, shared contract, screen or B1 change is needed.

If A rejects B for an open ask with A's soft blocker enabled, B is hidden from
that ask's results and A is hidden from B's matching requests. B switching off
their own blocker does not override A's choice. A disabling the source blocker
or resolving that ask releases its reverse exclusion, unless another open,
blocker-enabled ask by A also rejects B. Unrelated attendees are unaffected.

Outgoing exclusions still belong to the current ask. The batch cutoff and old
resolved-ask result behavior stay as before. Rejections are retained as history.
Each matching request reads a snapshot; changes apply to the next request.

The reverse IDs and pending-profile IDs are combined with SQL UNION, which
deduplicates them in one existing lookup. The query checks the signed-in user's
ID against the rejection's recipient and checks the source ask's open status
and blocker flag. IDs go to search exclusions before ranking/explanations; no
blocked-by list or other user's ask data is returned. A failed exclusion read
returns a sanitized 503. PR #25's nonfatal registration replay is preserved.

`FAKE_API=1` still runs the unchanged one-way fake. This B2-only task fixes the
real handler; the shared fake remains outside its allowed files. Automated
tests use the real handler/pipeline, fake search/AI and mocked Neon. They cover
both directions, both users' switches, multiple blocking asks, resolution,
unrelated users, ownership, batch cutoffs, registration recovery and failures.

## Complete manual checklist

This check contacts GitHub and Neon when you run it. It temporarily changes both
accounts' biographies and creates test asks/rejections. Keep both browser tabs
and their session-storage backups until cleanup. Search and AI stay fake.

1. Stop the previous server. In a fresh PowerShell terminal:

   ```powershell
   cd D:\Projects\convo-b2-two-way-blocker
   $env:FAKE_API = "0"
   $env:FAKES = "search,ai"
   $env:NODE_OPTIONS = "--enable-source-maps"
   node --env-file="D:\Projects\Convo\.env.local" .\node_modules\next\dist\bin\next dev --port 3000
   ```

   Use the database with the existing migrations through `0003` applied. Sign in
   as A at `http://localhost:3000` in a regular window and B in a private window.
   Complete onboarding for both. This branch adds no migration.

2. Run this complete setup block **once in each window**:

   ```js
   if (sessionStorage.getItem("convo.two-way-test")) throw new Error("Clean up the previous test first");
   var r = await fetch("/api/me");
   var person = await r.json();
   if (!r.ok) throw new Error(JSON.stringify(person));
   var test = {person, owner:person.id};
   sessionStorage.setItem("convo.two-way-test", JSON.stringify(test));
   var r = await fetch("/api/me", {method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify({bio:"ConvoTwoWayCheckToken"})});
   if (!r.ok) throw new Error(await r.text());
   var r = await fetch("/api/refine", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({text:"Explain ConvoTwoWayCheckToken"})});
   var created = await r.json();
   if (!r.ok) throw new Error(JSON.stringify(created));
   test.askId = created.askId;
   sessionStorage.setItem("convo.two-way-test", JSON.stringify(test));
   console.log("SETUP PASSED; account ID:", test.owner);
   ```

3. In **each window**, replace the placeholder with the other account's ID and
   run this baseline check. Both windows must see the other account before
   proceeding. Do not restart the server: these biographies are indexed in memory.

   ```js
   var test = JSON.parse(sessionStorage.getItem("convo.two-way-test"));
   test.target = "PASTE_OTHER_ACCOUNT_ID";
   if (test.target === "PASTE_OTHER_ACCOUNT_ID" || test.target === test.owner) throw new Error("Use the other account ID");
   var r = await fetch("/api/match", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({askId:test.askId})});
   var cards = await r.json();
   if (!r.ok) throw new Error(JSON.stringify(cards));
   test.card = cards.find(card => card.person.id === test.target);
   if (!test.card) throw new Error("Both accounts must match before this test; keep backups for cleanup");
   sessionStorage.setItem("convo.two-way-test", JSON.stringify(test));
   console.log("BASELINE PASSED");
   ```

4. In **A only**, reject B once. Repeating this POST is safe: the same person is
   never counted twice toward the batch cutoff.

   ```js
   var test = JSON.parse(sessionStorage.getItem("convo.two-way-test"));
   var r = await fetch("/api/rejections", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({askId:test.askId, personId:test.target, rank:test.card.rank})});
   var result = await r.json();
   if (!r.ok || result.rejections !== 1 || result.hiddenBelowRank !== null) throw new Error(JSON.stringify(result));
   console.log("REJECTION SAVED");
   ```

5. Use this self-contained check in either window whenever instructed below:

   ```js
   var test = JSON.parse(sessionStorage.getItem("convo.two-way-test"));
   var r = await fetch("/api/match", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({askId:test.askId})});
   var cards = await r.json();
   if (!r.ok) throw new Error(JSON.stringify(cards));
   console.log("OTHER ACCOUNT VISIBLE:", cards.some(card => card.person.id === test.target));
   ```

   Expected now: **false in both windows**.

6. In B, then A, run this switch-off block, checking visibility with step 5
   after each change:

   ```js
   var test = JSON.parse(sessionStorage.getItem("convo.two-way-test"));
   var r = await fetch("/api/soft-blocker", {method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify({askId:test.askId, enabled:false})});
   if (!r.ok) throw new Error(await r.text());
   console.log("OWN BLOCKER DISABLED");
   ```

   After B disables theirs: A must still be invisible to B. After A disables
   theirs: both windows must see the other account again.

7. In A, run the switch block again with `enabled:true`. Both windows should
   again report false in step 5. Resolve A's ask with this block:

   ```js
   var test = JSON.parse(sessionStorage.getItem("convo.two-way-test"));
   var r = await fetch("/api/asks/" + encodeURIComponent(test.askId) + "/resolve", {method:"POST"});
   if (!r.ok) throw new Error(await r.text());
   console.log("SOURCE ASK RESOLVED");
   ```

   Run step 5 in B. Expected: **true**. Automated tests additionally cover more
   than one active blocking ask and verify unrelated attendees remain visible.

8. Cleanup in **both windows**, including if an earlier step failed:

   ```js
   var test = JSON.parse(sessionStorage.getItem("convo.two-way-test"));
   if (!test?.person) throw new Error("No backup found");
   var r = await fetch("/api/me", {method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify({bio:test.person.bio})});
   var restored = await r.json();
   if (!r.ok || restored.id !== test.owner || restored.bio !== test.person.bio) throw new Error("Restore failed; keep backup");
   if (test.askId) {
     var r = await fetch("/api/asks/" + encodeURIComponent(test.askId) + "/resolve", {method:"POST"});
     if (!r.ok) throw new Error(await r.text());
   }
   sessionStorage.removeItem("convo.two-way-test");
   console.log("BIO RESTORED AND TEST ASK RESOLVED");
   ```

   Asks and rejections remain as history. Cleanup does not delete database rows.
   Keep backups and IDs if restoration or resolution fails.

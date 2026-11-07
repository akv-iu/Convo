# Recover saved ask registration

Branch: `b2/ask-registration-recovery`. No new migration, key or shared API
contract change. This work changes only B2 files.

If `/api/refine` saves an ask but search registration fails, it still returns
200 with `{ askId, refined }`. A fixed server warning records the failure without
provider details. The frontend retains the saved ID normally. Do not resubmit
`/api/refine`: each submission intentionally creates a different ask.

The real handler re-registers an owned, open ask using its saved refined text
alongside the profile, exclusion and pending-user lookups. The search interface
registers by ID and is safe to replay. This also repairs registration after an
application restart clears fake search. A failed replay logs a fixed warning and
matching still runs; registration alone never causes a 503 from either endpoint.
Resolved asks and older asks without a saved refinement retain their existing
matching behavior without being registered again. A concurrent resolution is
protected by B1's rule that a resolved ID cannot be reactivated.

Recovery requires the owner to request matching. There is no background worker;
until recovery runs, other users' reverse counts can omit the saved ask. Each
matching request includes one registration round trip (an existing Elasticsearch
ID returns its normal conflict, which B1 handles as success). It overlaps the
lookups instead of following them. A slow registration can still outlast those
lookups; real-service latency still needs measurement at integration.

## Complete manual checklist

These steps contact GitHub and Neon when you run them. Elasticsearch and OpenAI
stay fake. Automated tests already cover registration failures; do not break live
credentials or change production settings to simulate an outage.

1. Stop the previous server. In a fresh PowerShell terminal, run:

   ```powershell
   cd D:\Projects\convo-b2-ask-recovery
   $env:FAKE_API = "0"
   $env:FAKES = "search,ai"
   $env:NODE_OPTIONS = "--enable-source-maps"
   node --env-file="D:\Projects\Convo\.env.local" .\node_modules\next\dist\bin\next dev --port 3000
   ```

   Use the database with the existing migrations, including
   `0003_github_evidence.sql`, already applied. This branch adds no migration.
   The valid `NODE_OPTIONS` override prevents an `--env-file` value in your env
   file from breaking Node startup; it applies only to this terminal session.
   Open `http://localhost:3000`, sign in, and complete onboarding if needed.

2. In that signed-in tab's DevTools Console, paste this entire block once:

   ```js
   if (sessionStorage.getItem("convo.ask-recovery")) throw new Error("Clean up the previous test first");
   var r = await fetch("/api/refine", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({text:"How does Kubernetes scheduler preemption work?"})});
   var created = await r.json();
   if (!r.ok) throw new Error(JSON.stringify(created));
   sessionStorage.setItem("convo.ask-recovery", JSON.stringify(created));
   console.log("ASK SAVED", created.askId, created.refined);
   ```

   Expected: 200 and one saved ask ID. Keep that ID and this browser tab.

3. Stop the server with Ctrl+C and restart it with the same command from step 1.
   This clears the in-memory search registration while leaving the Neon row.
   Reload the tab. Paste this entire block; no previously defined helper is needed:

   ```js
   var test = JSON.parse(sessionStorage.getItem("convo.ask-recovery"));
   if (!test?.askId) throw new Error("Use the original test tab");
   for (var attempt = 1; attempt <= 2; attempt++) {
     var r = await fetch("/api/match", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({askId:test.askId})});
     var cards = await r.json();
     if (!r.ok || !Array.isArray(cards)) throw new Error(JSON.stringify(cards));
     console.log("MATCH RETRY PASSED", attempt, cards.length);
   }
   ```

   Expected: both requests return 200. A zero-length list can be legitimate;
   this check verifies recovery and replay, not a particular ranking.

4. In Neon's SQL editor, replace the placeholder with the saved ID:

   ```sql
   SELECT id, user_id, status, refined
   FROM asks
   WHERE id = 'PASTE_SAVED_ASK_ID';
   ```

   Expected: exactly one open row with the original refined text. There is no
   second refinement submission. Automated tests additionally verify that
   registration starts with the lookups and no second insert occurs.

5. Cleanup in the original browser tab:

   ```js
   var test = JSON.parse(sessionStorage.getItem("convo.ask-recovery"));
   if (!test?.askId) throw new Error("No test ask found");
   var r = await fetch("/api/asks/" + encodeURIComponent(test.askId) + "/resolve", {method:"POST"});
   var resolved = await r.json();
   if (!r.ok || resolved.status !== "resolved") throw new Error(JSON.stringify(resolved));
   var r = await fetch("/api/match", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({askId:test.askId})});
   if (!r.ok) throw new Error(await r.text());
   sessionStorage.removeItem("convo.ask-recovery");
   console.log("CLEANUP PASSED");
   ```

   Expected: resolution succeeds and the resolved ask remains resolved after
   matching. The database row remains as history; removing session storage does
   not delete it. Keep the stored ID if any check fails so cleanup can be retried.

Automated regressions cover successful refinement and matching during
registration failure, recovery on later matches without duplicate counts,
credential-free warnings, concurrent replay and lookups, owner scoping,
resolved/unrefined asks, and the actual HTTP responses. No live service is called
by those tests.

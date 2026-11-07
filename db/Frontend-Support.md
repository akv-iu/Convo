# Profile fields and frontend handoff

Branch: `b2/frontend-support`. The shared contract and fake change together.
Both people review the contract before merging. Person A can build against this
branch with `FAKE_API=1`; no accounts are needed for those screens.

## Payload A can use

`workplaceName` and `badgeColour` are **top-level Person fields**, not fields inside
`filters`. `filters.rorId` remains the directory identifier. Names are display
labels, not verified organisation identities or new matching filters.

```json
{
  "filters": { "country": "GB", "rorId": null, "hiring": true },
  "workplaceName": "Acme Robotics",
  "badgeColour": "lilac",
  "visibility": { "country": true, "workplace": true, "hiring": true }
}
```

Send this to `PUT /api/me`. The response and subsequent `GET /api/me` contain the
saved fields. They also travel with `MatchResult.person`, so other people's cards
can display them. Search metadata updates preserve repository evidence and use
the existing revision ordering.

- Custom workplace: `rorId: null`, `workplaceName: "Acme Robotics"`.
- Directory workplace: its real `rorId`, with its name in `workplaceName`.
- Independent: `rorId: null`, `workplaceName: null`.
- Names are trimmed, nonempty, at most 200 characters; use null to clear one.
- Colours: `sunflower`, `mint`, `sky`, `lilac`, `coral`. Send `sunflower` to reset.
- Omitted fields preserve stored values. Older records/clients may omit them;
  display the default colour when absent. A legacy ROR-ID change clears an old
  label unless the caller supplies the new label in the same save.
- GitHub sign-in preserves these user choices.
- The fake workplace directory remains 20 entries. Expanding it does not improve
  real ROR coverage. Use fake replies to test custom names and search errors.

## Changes for A's PR #13 and next screens

1. Send the fields above in the existing onboarding save. The cookie can preview
   a colour before sign-in, but it is not the saved profile's source of truth.
2. Read `GET /api/me` when restoring a saved profile. A 409 means first-time
   onboarding is incomplete: show the empty form. Treat other failures as errors,
   not as an empty profile. Prevent a late load from overwriting user edits.
3. Test a custom name and colour through save, reload and another browser session.
   For fake browser tests, isolate shared fake profile state or mock the GET/PUT
   replies. Check stored responses, not only the cookie or outgoing payload.
4. Continue A1 step 3 (profile edit/save), step 4 (availability), then ask/refine.
   Existing `GET/PUT /api/me` and `GET/PUT /api/availability` support those screens.
5. `GET /api/looking-for-me` now returns `{ "count": number }` in real mode, using
   the configured search implementation. Count distinct other people. With
   `FAKES=search,ai`, this is still the in-memory/demo search, not Elasticsearch.

6. Add visibility controls for country, workplace and hiring. Send the complete
   `visibility` object; true means visible. These choices affect cards only.
7. A2 cards must handle nullable `person.filters.country` and `hiring`. A null
   hiring value means hidden, **not** "not hiring". Hidden workplace returns null
   for both `workplaceName` and `filters.rorId`. Associated country/hiring badges
   are removed. Use the returned `badgeColour`, defaulting to sunflower.
8. `POST /api/asks/:id/resolve` now persists `status: "resolved"` and removes only
   that ask from reverse search. Repeating it is safe. Missing/foreign IDs return
   404; signed-out calls return 401. A search-sync 503 explicitly says to retry
   the **same ID**, which repairs search without creating another ask.

Owner `GET/PUT /api/me` always returns the full values; search retains them too.
Real match responses read current visibility from Postgres in one batch, so a
stale search document cannot undo a hide setting. Missing real-profile settings
hide these three fields; a database read failure returns 503. Public biography,
GitHub organisations and evidence text are not scrubbed by these section controls.

Resolution preserves ask history, requests and booked meetings; it does not delete
rows, cancel meetings or prohibit explicitly matching the saved question again.
It removes the ask's contribution to reverse-search counts and mutual interest.
The fake search is memory-only: restarting clears registered asks, while resolved
status in Postgres remains saved. Real Elasticsearch ask registration and removal
are implemented on main. Matching a saved open ask also retries its registration
after a failed write; resolved asks are not re-registered. See
[Ask-Recovery.md](Ask-Recovery.md) for the retry behavior. C2 still needs to verify
these paths with real services; the checklist below uses in-memory search.

PR #13's screen wiring is still Person A's task. This branch supplies the shared
contract, fake and backend; it does not silently modify that open frontend PR.

## One complete manual profile test

Automated tests mock storage and external services. The following is the optional
live test for the owner to run. It edits only the signed-in user's display fields
and restores them at the end. No table reset is necessary.

1. Apply the three-column migration before running real routes. In PowerShell:

   ```powershell
   cd D:\Projects\convo-b2-frontend-support
   node --env-file="D:\Projects\Convo\.env.local" .\node_modules\drizzle-kit\bin.cjs migrate
   ```

   This adds `users.workplace_name`, `users.badge_colour` and `users.visibility`; it drops nothing.
   If Node says `--env-file` is not allowed in `NODE_OPTIONS`, remove that invalid
   option from the current shell's `NODE_OPTIONS` and rerun the command. Do not
   put `--env-file` inside `NODE_OPTIONS`.

2. Stop the old development server, then start this worktree:

   ```powershell
   Copy-Item -LiteralPath D:\Projects\Convo\.env.local -Destination .env.local
   $env:FAKE_API = "0"
   $env:FAKES = "search,ai"
   npm run dev -- --port 3000
   ```

3. Sign in at `http://localhost:3000/api/auth/signin`. Finish onboarding if needed.
   In the same localhost tab, paste this complete console block:

   ```js
   window.profileApi = async (body) => {
     const r = await fetch("/api/me", body === undefined ? {} : {
       method: "PUT", headers: { "Content-Type": "application/json" },
       body: JSON.stringify(body)
     });
     const value = await r.json();
     if (!r.ok) throw new Error(JSON.stringify({ status: r.status, value }));
     return value;
   };
   if (sessionStorage.getItem("convo.display-test")) throw new Error("Restore the previous test first.");
   var original = await profileApi();
   sessionStorage.setItem("convo.display-test", JSON.stringify({
     owner: original.id, workplaceName: original.workplaceName ?? null,
     badgeColour: original.badgeColour ?? "sunflower",
     visibility: original.visibility ?? {country:true, workplace:true, hiring:true}
   }));
   var saved = await profileApi({ workplaceName: "  Acme Robotics  ", badgeColour: "lilac", visibility: {country:false, workplace:false, hiring:false} });
   if (saved.workplaceName !== "Acme Robotics" || saved.badgeColour !== "lilac") throw new Error("Save mismatch");
   var loaded = await profileApi();
   if (loaded.workplaceName !== "Acme Robotics" || loaded.badgeColour !== "lilac") throw new Error("Read mismatch");
   if (Object.values(loaded.visibility).some(Boolean)) throw new Error("Visibility save failed");
   if (JSON.stringify(loaded.filters) !== JSON.stringify(original.filters)) throw new Error("Hiding changed matching fields");
   console.log("SAVE AND READ PASSED");
   ```

4. Restart the same server and reload the same browser tab. Stay signed in, then:

   ```js
   var r = await fetch("/api/me");
   var loaded = await r.json();
   if (r.status !== 200 || loaded.workplaceName !== "Acme Robotics" || loaded.badgeColour !== "lilac") throw new Error("Persistence failed");
   if (Object.values(loaded.visibility).some(Boolean)) throw new Error("Visibility did not persist");
   console.log("PERSISTENCE PASSED");
   ```

5. Invalid writes must each return 400:

   ```js
   for (var body of [{workplaceName:" "}, {workplaceName:"x".repeat(201)}, {badgeColour:"neon"}, {visibility:{country:false}}]) {
     var r = await fetch("/api/me", {method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body)});
     if (r.status !== 400) throw new Error("Expected 400, got " + r.status);
   }
   console.log("VALIDATION PASSED");
   ```

6. Restore the original display values (keep this tab until it succeeds):

   ```js
   var backup = JSON.parse(sessionStorage.getItem("convo.display-test"));
   var current = await (await fetch("/api/me")).json();
   if (!backup || current.id !== backup.owner) throw new Error("Sign in as the original test account");
   var r = await fetch("/api/me", {method:"PUT", headers:{"Content-Type":"application/json"},
     body:JSON.stringify({workplaceName:backup.workplaceName, badgeColour:backup.badgeColour, visibility:backup.visibility})});
   var restored = await r.json();
   if (!r.ok || restored.workplaceName !== backup.workplaceName || restored.badgeColour !== backup.badgeColour) throw new Error("Restore failed; keep the backup");
   if (JSON.stringify(restored.visibility) !== JSON.stringify(backup.visibility)) throw new Error("Visibility restore failed");
   sessionStorage.removeItem("convo.display-test");
   console.log("RESTORED");
   ```

7. Sign out at `/api/auth/signout`, then `fetch('/api/looking-for-me')` must return
   401. Signed in with a completed profile, it returns 200 and a nonnegative count.
   The absolute count in fake-search mode depends on the demo data and asks in
   the current server process.

## Two-account card, counter and resolution test

Run after the profile test above. Keep `FAKE_API=0`, `FAKES=search,ai`. This needs
two different GitHub accounts: A in a normal window, B in an incognito window.
Both must have completed onboarding. Do not run other ask tests concurrently.
No browser automation or live service call has been run by the agent.

1. Restart the local server once to start with an empty in-memory ask index.
   Sign A back in. In A's console, paste this whole block. It backs up the fields
   it changes and saves a unique searchable biography with hidden card sections:

   ```js
   if (sessionStorage.getItem("convo.privacy-test")) throw new Error("Restore the earlier test first");
   var r = await fetch("/api/me");
   if (!r.ok) throw new Error("Sign in and complete onboarding as A");
   var me = await r.json();
   sessionStorage.setItem("convo.privacy-test", JSON.stringify({owner:me.id, bio:me.bio,
     workplaceName:me.workplaceName ?? null, badgeColour:me.badgeColour ?? "sunflower",
     visibility:me.visibility ?? {country:true, workplace:true, hiring:true}}));
   var r = await fetch("/api/me", {method:"PUT", headers:{"Content-Type":"application/json"},
     body:JSON.stringify({bio:"ConvoPrivacyLifecycleProbe", workplaceName:"Acme Robotics",
       badgeColour:"lilac", visibility:{country:false, workplace:false, hiring:false}})});
   if (!r.ok) throw new Error(await r.text());
   var r = await fetch("/api/looking-for-me");
   var count = await r.json();
   if (!r.ok || count.count !== 0) throw new Error("Restart the server before this test; expected 0");
   console.log("A ID — copy this for step 2:", me.id);
   ```

2. In B's incognito window, sign in at `http://localhost:3000/api/auth/signin`
   using a different account. Replace `PASTE_A_ID` below with A's printed ID.
   Paste the whole block. It creates two asks and checks A's actual card payload:

   ```js
   window.probeApi = async (path, body) => {
     const r = await fetch("/api/" + path, body === undefined ? {} : {
       method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body)});
     const value = await r.json();
     if (!r.ok) throw new Error(JSON.stringify({status:r.status, value}));
     return value;
   };
   if (sessionStorage.getItem("convo.lifecycle-test")) throw new Error("Finish the previous test first");
   var aId = "PASTE_A_ID";
   var b = await probeApi("me");
   if (b.id === aId || aId === "PASTE_A_ID") throw new Error("Use different accounts and paste A's ID");
   var test = {owner:b.id, aId, ids:[]};
   sessionStorage.setItem("convo.lifecycle-test", JSON.stringify(test));
   for (var i = 0; i < 2; i++) {
     var created = await probeApi("refine", {text:"ConvoPrivacyLifecycleProbe"});
     test.ids.push(created.askId);
     sessionStorage.setItem("convo.lifecycle-test", JSON.stringify(test));
   }
   var cards = await probeApi("match", {askId:test.ids[0]});
   var card = cards.find(c => c.person.id === aId);
   if (!card) throw new Error("A should still match while fields are hidden");
   if (card.person.filters.country !== null || card.person.filters.hiring !== null ||
       card.person.filters.rorId !== null || card.person.workplaceName !== null) throw new Error("Hidden field leaked");
   if (card.person.badgeColour !== "lilac") throw new Error("Saved colour missing from other person's card");
   console.log("PRIVATE CARD PASSED", card);
   ```

3. In A's window, run this. Expected count: **1**, even though B has two asks.

   ```js
   var r = await fetch("/api/looking-for-me");
   var value = await r.json();
   if (!r.ok || value.count !== 1) throw new Error("Expected exactly one person");
   console.log("COUNTER PASSED", value);
   ```

4. In B's window, resolve the first ask twice (second call proves safe retry):

   ```js
   var test = JSON.parse(sessionStorage.getItem("convo.lifecycle-test"));
   for (var i = 0; i < 2; i++) {
     var r = await fetch(`/api/asks/${test.ids[0]}/resolve`, {method:"POST"});
     var value = await r.json();
     if (!r.ok || value.id !== test.ids[0] || value.status !== "resolved") throw new Error("Resolve failed");
   }
   console.log("FIRST ASK RESOLVED; RETRY PASSED");
   ```

   Repeat step 3 in A's window: count must still be **1**, because B's second ask
   remains open. Then return to B and resolve the second ask:

   ```js
   var test = JSON.parse(sessionStorage.getItem("convo.lifecycle-test"));
   var r = await fetch(`/api/asks/${test.ids[1]}/resolve`, {method:"POST"});
   var value = await r.json();
   if (!r.ok || value.status !== "resolved") throw new Error("Second resolve failed");
   console.log("SECOND ASK RESOLVED");
   ```

5. In A's window, verify the count is now **0**:

   ```js
   var r = await fetch("/api/looking-for-me");
   var value = await r.json();
   if (!r.ok || value.count !== 0) throw new Error("Resolved asks still counted");
   console.log("LIFECYCLE PASSED");
   ```

6. Check owner enforcement: copy one B ask ID, then in A's window replace the
   placeholder and run. Expected **404**, because it belongs to B:

   ```js
   var r = await fetch("/api/asks/PASTE_B_ASK_ID/resolve", {method:"POST"});
   if (r.status !== 404) throw new Error("Expected 404 for another user's ask");
   console.log("OWNER CHECK PASSED");
   ```

7. Restore A's fields **before closing A's window**:

   ```js
   var backup = JSON.parse(sessionStorage.getItem("convo.privacy-test"));
   var r = await fetch("/api/me");
   var current = await r.json();
   if (!r.ok || !backup || current.id !== backup.owner) throw new Error("Sign in as A first");
   var {owner, ...fields} = backup;
   var r = await fetch("/api/me", {method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify(fields)});
   var restored = await r.json();
   if (!r.ok || Object.keys(fields).some(k => JSON.stringify(restored[k]) !== JSON.stringify(fields[k]))) throw new Error("Restore failed; keep backup");
   sessionStorage.removeItem("convo.privacy-test");
   console.log("A RESTORED");
   ```

8. Restart the server and reload B's tab while B stays signed in. Paste this
   complete block; it does not rely on a console helper surviving reload:

   ```js
   var test = JSON.parse(sessionStorage.getItem("convo.lifecycle-test"));
   var r = await fetch("/api/me");
   var current = await r.json();
   if (!r.ok || !test || current.id !== test.owner) throw new Error("Sign in as B first");
   for (var id of test.ids) {
     var r = await fetch(`/api/asks/${id}/resolve`, {method:"POST"});
     var value = await r.json();
     if (!r.ok || value.id !== id || value.status !== "resolved") throw new Error("Saved ask retry failed");
   }
   console.log("POST-RESTART RETRY PASSED", test.ids);
   ```

   In Neon, those two IDs should still be present in `asks` with `status=resolved`.
   Resolution retains rows intentionally. The repeated POST alone cannot prove
   the pre-restart status, because it writes resolved again; inspect Neon for
   that persistence check if desired.

9. Sign **B out** at `/api/auth/signout`, then run this in B's same tab:

   ```js
   var test = JSON.parse(sessionStorage.getItem("convo.lifecycle-test"));
   var r = await fetch(`/api/asks/${test.ids[0]}/resolve`, {method:"POST"});
   if (r.status !== 401) throw new Error("Expected 401 while signed out");
   sessionStorage.removeItem("convo.lifecycle-test");
   console.log("SIGNED-OUT CHECK AND CLEANUP PASSED");
   ```

   Clearing session storage removes only test bookkeeping, never database rows.
   If a test stops early, keep the stored IDs, sign back in as B and resolve each
   created ask before clearing them. Restore A with step 7 regardless of where
   the test stopped.

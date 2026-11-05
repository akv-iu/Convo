# Workplace lookup

The real `GET /api/ror?q=Stanford` now searches ROR's v2 organizations API.
Signed-in users receive up to eight active workplaces in ROR relevance order,
each with `{ id, name, country }`. Names use `ror_display`; country uses the
first location because the shared API has room for one country per workplace.
The user's own country answer is separate and is not changed by this lookup.

No new environment variable, account, dependency or database migration is needed.
The previous profile revision migration must already be applied for real sign-in
and profile saves, as described in [Profile API](Profile-API.md).

## A1 handoff

- Keep using `/api/ror?q=` and the existing RorMatch schema. `FAKE_API=1` continues
  to return fixture workplaces and makes no ROR request.
- Send the selected result's `id` as `filters.rorId` in `PUT /api/me`, together
  with the existing country and hiring answers. `null` means no workplace.
- Blank or missing searches return `[]` without an external call. Unmatched
  searches also return `[]`. Queries over 200 characters after trimming return
  400 in real mode. Limit the input to 200 characters and debounce typeahead
  requests (about 300 ms), discarding replies for older input.
- Signed-out requests return 401. ROR failures, rate limits, timeouts and invalid
  replies return 503 with a retry message. Show that as an error, rather than as
  no workplaces found. Requests time out after five seconds and never auto-retry.
- Only the first provider page is searched, with at most eight results returned.
  The server does one request per nonblank lookup, without an in-process cache.

Implementation references: [ROR search](https://ror.readme.io/docs/api-query),
[data structure](https://ror.readme.io/docs/ror-data-structure), and
[identifier format](https://ror.readme.io/docs/identifier). ROR's
[client-ID page](https://ror.readme.io/docs/client-id) currently says registration
is paused and client-ID-based limits are not enforced during the pause. Recheck
that guidance before increasing traffic; this version uses anonymous requests.
The test fixture is a hand-written subset of the documented schema, not a live
recording or a complete list of ROR records.

## Complete manual test

These steps call live GitHub/ROR and temporarily change your workplace in Neon.
They use the local OAuth credentials, not the Vercel app. Keep production in fake
mode until the later integration checkpoint. Run each numbered step in order.

1. Stop any old app on port 3000 with Ctrl+C in its terminal. Open PowerShell:

   ```powershell
   cd D:\Projects\convo-b2-ror
   Copy-Item "D:\Projects\Convo\.env.local" ".env.local"
   $env:FAKE_API = "0"
   $env:FAKES = "search,ai"
   npm run dev -- --port 3000
   ```

   Leave that terminal running. Next loads `.env.local` automatically.

2. Open `http://localhost:3000/api/auth/signin` and sign in with GitHub. Press
   F12, choose Console, and paste this helper. Its initial `undefined` is normal.
   You can paste it again if you change/reload pages:

   ```javascript
   async function api(path, body) {
     const response = await fetch(`/api/${path}`, body === undefined ? {} : {
       method: "PUT", headers: { "Content-Type": "application/json" },
       body: JSON.stringify(body),
     });
     const result = { status: response.status, body: await response.json() };
     console.log(result);
     return result;
   }
   ```

3. In that browser console, check a known workplace:

   ```javascript
   var workplaces = (await api("ror?q=Stanford")).body;
   console.table(workplaces);
   ```

   Expect 200 and one to eight objects. Stanford University should be present,
   with a `https://ror.org/...` ID and country `US`.

4. Check empty and unmatched searches:

   ```javascript
   await api("ror");
   await api("ror?q=");
   await api("ror?q=" + encodeURIComponent("convo-no-such-workplace-7f9"));
   ```

   Expect 200 and `[]` for each. A 503 means the provider is unavailable, not
   that the empty-match test passed; report it before continuing.

5. Check names containing punctuation and oversized input:

   ```javascript
   await api("ror?q=" + encodeURIComponent("Texas A&M University"));
   await api("ror?q=" + "x".repeat(201));
   ```

   Expect 200 with workplace results for the first and 400 with a clear
   200-character message for the second. A red 400 line in the console is
   expected for the deliberately invalid request.

6. Capture your existing filters before making a temporary test edit:

   ```javascript
   var currentProfile = await api("me");
   if (currentProfile.status !== 200) throw new Error("Stop: profile did not load");
   sessionStorage.setItem("convo.ror-test.originalFilters", JSON.stringify(currentProfile.body.filters));
   ```

   Expect 200. The original filters are kept in this tab's session storage so a
   page reload will not lose them. Keep this tab open until step 8 restores them.

7. Save Stanford as a temporary workplace, preserving your other answers:

   ```javascript
   var selected = workplaces.find(workplace => workplace.name === "Stanford University");
   if (!selected) throw new Error("Stop: Stanford was not returned");
   await api("me", { filters: { ...currentProfile.body.filters, rorId: selected.id } });
   await api("me");
   ```

   Expect 200 for both. `filters.rorId` must equal the selected ID; country,
   hiring, bio, identity and availability must remain unchanged.

8. Stop the server with Ctrl+C and restart it in the same PowerShell terminal:

   ```powershell
   npm run dev -- --port 3000
   ```

   In the browser, run `await api("me")` again. If needed, paste the helper from
   step 2 again. Expect 200 and the same selected workplace after restarting.
   Then restore your actual answers:

   ```javascript
   var savedFilters = JSON.parse(sessionStorage.getItem("convo.ror-test.originalFilters"));
   if (!savedFilters) throw new Error("Stop: original filters are missing; do not save");
   await api("me", { filters: savedFilters });
   await api("me");
   ```

   Expect 200 and your original filters restored. After checking that result:

   ```javascript
   sessionStorage.removeItem("convo.ror-test.originalFilters");
   ```

9. Open `http://localhost:3000/api/auth/signout` and confirm sign-out. Then open
   `http://localhost:3000/api/ror?q=Stanford`. Expect
   `{"error":"sign in first"}` and HTTP401 in the browser Network tab.

10. Stop the server. Restore `$env:FAKE_API = "1"` in that PowerShell terminal
    when returning to fake mode. Report whether steps 3–9 all passed; for a
    failure, share the step, status and error text without credentials.

Automated tests cover both actual HTTP implementations (fake and real), query
escaping, schema conversion, inactive records, result limits and provider
failures. They stub fetch and never call the live providers or database.

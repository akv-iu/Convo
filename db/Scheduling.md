# Slots and booking

Implements GET `/api/requests/:id/slots` and POST
`/api/requests/:id/schedule` with `{ slot: { start, end } }`. No schema change,
migration, dependency or credential change. Use `FAKE_API=0`, `FAKES=search,ai`
for manual testing: Postgres is real, search and AI remain fake.

## Behavior and frontend handoff

- Only the sender and addressed receiver can list or book slots. Missing request:
  404; outsider: 403; signed out: 401; malformed body: 400.
- Real suggestions require an accepted, unbooked request; other states return
  `[]`. Book before acceptance: 409. The frozen fake remains permissive on these
  negative cases; the normal accept/list/book flow and response schemas match.
- Up to three suggestions use both participants' free times and skip any saved
  slot involving either participant, regardless of its current request status.
  Registered users are read from Postgres; missing users use one batched search
  availability lookup. Synthetic recipients cannot sign in to accept requests.
- Duplicate, overlapping and adjacent free-time blocks are merged before finding
  an overlap. Slots have the request's exact duration. Suggestions leave a minute
  for selection beyond the strict one-hour booking cutoff, so a slot at the
  cutoff does not become stale immediately while the user clicks it.
- Booking checks shared availability, meeting duration and the one-hour cutoff
  again. Any valid interval can be booked; it need not equal one of the first
  three suggestions. The database write rechecks authorization, accepted/unbooked
  state, duration, registered profile revisions, database time, and conflicts.
- The conditional update runs inside a Neon HTTP **Serializable** transaction.
  This prevents two distinct request rows from both winning an overlapping
  booking. Serialization errors and stale conditions return 409; refresh slots.
  No automatic transaction retry. See [PostgreSQL transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html)
  and [Neon HTTP transactions](https://neon.com/docs/serverless/serverless-driver).
- Repeating an already committed booking for the same request and exact instants
  returns the saved request, even inside the one-hour cutoff. Different timezone
  offsets for the same instants count as identical. Moving an existing booking
  returns 409; cancellation/rescheduling is not part of this slice.
- Network failure can leave the commit outcome uncertain: 503 says to check the
  inbox before retrying the same slot. Dependency details/credentials are never
  returned. If the transaction committed but its returned data is invalid, the
  error explicitly says the booking was saved.
- The existing respond API can change a booked request's status and retains its
  slot. That slot continues to reserve the time. A response is not a cancellation.
- Postgres profile revisions protect against availability changes between reading
  and booking. Search-only availability is a snapshot from an external system,
  not part of the Postgres transaction. Synthetic live booking is not promised.
- No frontend or frozen contract files changed. The existing fake also uses the
  corrected pure slot finder, so merged availability behaves the same there.

## Verification scope

Automated tests use the real Drizzle query builder with a mocked Neon driver.
They check SQL ownership/conflict/revision predicates, Serializable transaction
options, serialization failure handling, safe retries, malformed/stale data,
slot math, self-send, and fake/real HTTP happy-path and authorization parity.
They never connect to Postgres, Elasticsearch, OpenAI or GitHub. The manual race
below is required to verify concurrent commits against actual Postgres.

## Full manual test

This uses one GitHub account and three self-addressed requests. It temporarily
replaces your availability, saves a backup in this tab, and restores it at the
end. Do not close the tab or clear its session storage until cleanup is complete.

### 1. Start

Stop your old dev server with Ctrl+C, then:

```powershell
cd D:\Projects\convo-b2-scheduling
Copy-Item -LiteralPath D:\Projects\Convo\.env.local -Destination .env.local
$env:FAKE_API = "0"
$env:FAKES = "search,ai"
npm run dev -- --port 3000
```

Sign in at `http://localhost:3000/api/auth/signin`, return to a localhost page,
and open DevTools Console. Use the same tab throughout. The test times are
generated three hours ahead, so they do not depend on the conference date.

### 2. Helper (paste again after navigation/reload)

```js
window.api = async (path, body, expected = 200, method = body === undefined ? "GET" : "POST") => {
  const r = await fetch(`/api/${path}`, {
    method, headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const data = await r.json();
  console.log(path, r.status, data);
  if (r.status !== expected) throw new Error(`Expected ${expected}; got ${r.status}`);
  return data;
};
window.check = (ok, message) => { if (!ok) throw new Error(message); };
window.saveTest = t => sessionStorage.setItem("convo.schedule-test", JSON.stringify(t));
```

### 3. Set up once

```js
check(!sessionStorage.getItem("convo.schedule-test"), "Existing test: resume or clean it up first.");
var me = await api("me");
var original = await api("availability");
var start = Math.ceil((Date.now() + 3 * 3600000) / 60000) * 60000;
var test = { owner: me.id, original, askId: null, ids: [],
  window: { start: new Date(start).toISOString(), end: new Date(start + 3600000).toISOString() } };
saveTest(test);
await api("availability", [test.window], 200, "PUT");
var ask = await api("refine", { text: "scheduler preemption" });
test.askId = ask.askId; saveTest(test);
for (var i = 0; i < 3; i++) {
  var sent = await api("requests", { askId: test.askId, toPersonId: me.id });
  test.ids.push(sent.id); saveTest(test);
  if (i < 2) await api(`requests/${sent.id}/respond`, { action: "accept" });
}
var suggested = await api(`requests/${test.ids[0]}/slots`);
check(suggested.length > 0 && suggested.length <= 3, "Expected 1-3 slots");
test.slot = suggested[0]; saveTest(test);
check(Date.parse(test.slot.start) >= Date.now() + 3600000, "Slot is too soon");
check(Date.parse(test.slot.end) - Date.parse(test.slot.start) === ask.refined.minutes * 60000, "Wrong meeting length");
console.log("SETUP PASSED", test);
```

Expected: all 200, then SETUP PASSED. First two requests are accepted; the third
is deliberately still sent. If `me` returns 409, finish onboarding first. If any
step fails, stop and preserve the test state for troubleshooting and cleanup.

### 4. Invalid bookings while signed in

```js
var test = JSON.parse(sessionStorage.getItem("convo.schedule-test"));
var duration = Date.parse(test.slot.end) - Date.parse(test.slot.start);
await api(`requests/${test.ids[2]}/schedule`, { slot: test.slot }, 409);
await api(`requests/${test.ids[0]}/schedule`, {
  slot: { start: test.slot.start, end: new Date(Date.parse(test.slot.end) + 60000).toISOString() }
}, 400);
var soon = Date.now() + 30 * 60000;
await api(`requests/${test.ids[0]}/schedule`, {
  slot: { start: new Date(soon).toISOString(), end: new Date(soon + duration).toISOString() }
}, 409);
var outside = Date.parse(test.window.end) + 3600000;
await api(`requests/${test.ids[0]}/schedule`, {
  slot: { start: new Date(outside).toISOString(), end: new Date(outside + duration).toISOString() }
}, 409);
await api("requests/missing-request/slots", undefined, 404);
await api("requests/missing-request/schedule", { slot: test.slot }, 404);
```

Expected: 409, 400, 409, 409, 404, 404. Red network entries are expected.

### 5. Race two accepted requests for the same time (run once)

```js
var race = await Promise.all(test.ids.slice(0, 2).map(async id => {
  const r = await fetch(`/api/requests/${id}/schedule`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slot: test.slot })
  });
  return { id, status: r.status, body: await r.json() };
}));
console.table(race.map(({ id, status }) => ({ id, status })));
check(JSON.stringify(race.map(r => r.status).sort()) === "[200,409]", "Expected exactly one booking and one conflict");
test.winner = race.find(r => r.status === 200).id;
test.loser = race.find(r => r.status === 409).id;
saveTest(test);
var again = await api(`requests/${test.winner}/schedule`, { slot: test.slot });
check(again.id === test.winner && again.status === "scheduled", "Same-slot retry failed");
var remaining = await api(`requests/${test.loser}/slots`);
check(remaining.length > 0, "Expected another free slot");
check(remaining.every(s => Date.parse(s.end) <= Date.parse(test.slot.start) || Date.parse(s.start) >= Date.parse(test.slot.end)), "Booked time was offered again");
test.secondSlot = remaining[0]; saveTest(test);
await api(`requests/${test.loser}/schedule`, { slot: test.secondSlot });
console.log("RACE AND RETRY PASSED");
```

Expected: race results are exactly one 200 and one 409; the retry and subsequent
nonoverlapping booking return 200, followed by RACE AND RETRY PASSED. If both race
requests return 200, stop and report it. This script deliberately does not hide
or retry a conflict.

### 6. Restart and verify persistence

Stop/restart the same server, reload the same tab, and paste the helper again.
Stay signed in.

```js
var test = JSON.parse(sessionStorage.getItem("convo.schedule-test"));
var inbox = await api("inbox");
for (var [id, slot] of [[test.winner, test.slot], [test.loser, test.secondSlot]]) {
  var item = inbox.find(r => r.id === id);
  check(item?.status === "scheduled", "Scheduled request missing after restart");
  check(Date.parse(item.slot.start) === Date.parse(slot.start) && Date.parse(item.slot.end) === Date.parse(slot.end), "Saved slot differs");
}
check((await api(`requests/${test.winner}/slots`)).length === 0, "Already-booked request offered slots");
console.log("PERSISTENCE PASSED");
```

Expected: 200 responses and PERSISTENCE PASSED.

### 7. Sign out and verify authentication

Visit `http://localhost:3000/api/auth/signout` and confirm sign-out. Paste the
helper again; stay signed out for these calls:

```js
var test = JSON.parse(sessionStorage.getItem("convo.schedule-test"));
await api("requests/signed-out-test/slots", undefined, 401);
await api("requests/signed-out-test/schedule", { slot: test.slot }, 401);
```

Expected: both 401. Automated tests cover an unrelated signed-in user's 403 on
both routes. Optional two-account test: another real GitHub account that is not
a participant must get 403 using your request ID; a real addressed receiver can
accept/list/book, using the same calls above in its own browser profile.

### 8. Restore availability and clean up

Sign back in as the original account, return to localhost, and paste the helper.

```js
var test = JSON.parse(sessionStorage.getItem("convo.schedule-test"));
var me = await api("me");
check(me.id === test.owner, "Sign in as the original test account");
await api("availability", test.original, 200, "PUT");
console.log("CLEANUP IDS", { askId: test.askId, owner: test.owner });
```

Expected: 200; your original availability is restored. In Neon SQL Editor, replace
the two placeholders below with the exact printed IDs. Do not drop any table.

```sql
BEGIN;
DELETE FROM requests
WHERE ask_id IN (SELECT id FROM asks WHERE id = 'YOUR_TEST_ASK_ID' AND user_id = 'YOUR_OWNER_ID')
RETURNING id;
DELETE FROM asks WHERE id = 'YOUR_TEST_ASK_ID' AND user_id = 'YOUR_OWNER_ID'
RETURNING id;
COMMIT;
SELECT id FROM requests WHERE ask_id = 'YOUR_TEST_ASK_ID';
SELECT id FROM asks WHERE id = 'YOUR_TEST_ASK_ID';
```

Expected: three requests and one ask deleted; both final SELECTs return zero rows.
If an earlier step failed, fewer rows may exist. `RETURNING id` shows which rows
were deleted. On SQL failure, ROLLBACK and report it; do not broaden the deletion.
Only after verifying restoration and database cleanup:

```js
sessionStorage.removeItem("convo.schedule-test");
```

Session storage cleanup alone does not delete database rows or restore availability.

## Recovery from the two-409 response bug

The original booking SQL returned `jsonb_build_object` without the SQL alias
`saved`. Executing that SQL directly through Neon bypasses Drizzle's result
mapping. The database could commit a booking while the API failed to find the
expected field and incorrectly returned 409. The fix adds the SQL alias and
distinguishes a genuinely empty result from a committed row with invalid data.
Regression tests verify the generated alias and the committed-row error path.

After restarting this checkout, stay signed in as the original user, paste the
helper from step 2, then run this preparation block once. It preserves the
original availability backup and the same test ask. It records two additional
requests, so cleanup can delete five requests instead of the original three.

```js
var test = JSON.parse(sessionStorage.getItem("convo.schedule-test"));
check(test?.askId && test?.original && test?.ids?.length >= 2, "Missing original test state; stop here.");
check(!test.recoveryIds?.length, "Recovery pair already exists; do not create it twice.");
var me = await api("me");
check(me.id === test.owner, "Sign in as the original test account.");
var inbox = await api("inbox");
console.table(inbox.filter(r => test.ids.includes(r.id)).map(r => ({ id: r.id, status: r.status, slot: r.slot })));
test.recoveryIds = []; saveTest(test);
for (var i = 0; i < 2; i++) {
  var sent = await api("requests", { askId: test.askId, toPersonId: test.owner });
  test.recoveryIds.push(sent.id); saveTest(test);
  await api(`requests/${sent.id}/respond`, { action: "accept" });
}
var available = await api(`requests/${test.recoveryIds[0]}/slots`);
check(available.length > 0, "No slots remain; stop and report this without clearing the backup.");
test.ids = [...test.recoveryIds, ...test.ids];
test.slot = available[0];
delete test.winner; delete test.loser; delete test.secondSlot;
saveTest(test);
console.log("RECOVERY PAIR READY");
```

Now run step 5 once. Expect one 200 and one 409, then successful identical retry
and nonoverlapping booking. Continue steps 6-8. The cleanup SQL is scoped to the
same ask, so it removes both the old requests and the recovery pair. Do not rerun
the full setup: it would overwrite or lose the original availability backup.

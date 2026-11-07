# Saved requests, inbox and responses

This B2 slice implements POST `/api/requests`, GET `/api/inbox`, GET
`/api/requests/sent`, GET `/api/asks/:id` and POST `/api/requests/:id/respond`. It uses the existing requests table: no migration,
reset, new dependency or credential change. Test with `FAKE_API=0` and
`FAKES=search,ai`: Neon is real; search and AI are still fake.

## Frontend handoff

- Send `{ askId, toPersonId }`. The sender comes from the authenticated session.
  The ask must belong to that sender (404 otherwise). The question and minutes
  are copied from its stored refinement, or raw text and 10 minutes if unrefined.
  Client-supplied sender, question, minutes, status and reply fields are ignored.
- Recipients are checked in Postgres first, then through B1's approved
  `search.getPerson(id)` addition. Search-only and synthetic profiles are valid
  recipients; they do not create fabricated Postgres users. Unknown people return
  404; lookup failures return sanitized 503 and do not create a request.
- The inbox contains only requests addressed to the session user, newest first,
  with ID as a deterministic tie-breaker. An empty inbox is `[]`. It does not
  contain outgoing requests unless the sender also addressed themselves.
- **GET `/api/requests/sent`** is the asker's side: requests the session user
  sent, newest first, so they can see accept/decline, the receiver's reply and
  the booked `slot`.
- Both lists return `RequestView`: the request plus `type` (the ask's type, null
  if unrefined) and `person`, the **other person's badge**. That's the asker in
  the inbox and the receiver in sent requests. The badge is a `CardPerson`, with
  that person's show/hide choices applied (hidden sections are null, the settings
  themselves aren't returned). Accounts are read from Postgres. People without
  an account (synthetic) come from one batched search read. A real account found
  only in search shows nothing, and an unfinished profile gives `person: null`,
  as does someone who can't be found. If search is down, the list returns 503
  rather than leaving out badges. Other routes (send, respond, schedule) still
  return a plain `Request`; keep the badge you already have when you update an
  item.
- **GET `/api/asks/:id`** returns the caller's own `Ask` (question, refinement,
  status, `softBlocker`), so a new tab can show the question and the real
  switch state. Someone else's ask returns 404.
- Respond with `{ action: "accept" }`, `{ action: "decline" }`, or
  `{ action: "reply", reply: "..." }`. Status becomes accepted, declined or
  answered. Only the receiver can update it: 403 for anyone else, 404 if missing.
  Authorization is part of the SQL update, not a separate read-then-write check.
- All three routes require sign-in (401). Invalid bodies return 400. Storage
  errors return sanitized 503. A response write can have committed before a
  network timeout: check the receiver inbox before retrying a response.
- **One request per person per ask** (unique `ask_id, to_person_id`). Sending
  again, or retrying after a timeout, returns the request already saved (same
  ID, current status) instead of a duplicate in the receiver's inbox. Matching
  leaves out people this ask already sent a request to, while everyone else
  keeps their rank (see [Rejections.md](Rejections.md)). The fake does the same.
- Self-send is allowed; changing a response is allowed; accept/decline preserve
  earlier reply text and any slot. No lifecycle restrictions were added here.
  Concurrent responses use the last committed status; only reply actions replace
  the reply field. Avoid automatic POST retries and overlapping UI saves.
- This is persisted in-app delivery, not email or GitHub messaging. Synthetic
  people cannot sign in to read or respond. Real Elasticsearch lookup remains
  B1's later implementation. Booking, resolution and the counter are later slices.

## Automated verification

Two critical review/test rounds cover ownership, receiver-only updates, forged
fields, send/inbox/response parity with the frozen fake, raw/refined snapshots,
registered/search-only/unknown recipients, malformed stored data, sanitized
failures, duplicate behavior and retained reply/slot fields. Tests use the real
Drizzle query builder with a mocked Neon driver, plus fake search; no live service.

Run `npm run lint`, `npm run typecheck`, and `npm test`. To check this service's
coverage (the default coverage configuration predates the requests folder):

```powershell
npx vitest run src/server/requests/messages.test.ts src/app/api/requests/route.test.ts --coverage --coverage.include=src/server/requests/messages.ts --coverage.reporter=text
```

## Manual test, all steps

### 1. Start this checkout

Stop the old port-3000 server with Ctrl+C in its terminal. Then:

```powershell
cd D:\Projects\convo-b2-requests
Copy-Item -LiteralPath D:\Projects\Convo\.env.local -Destination .env.local
$env:FAKE_API = "0"
$env:FAKES = "search,ai"
npm run dev -- --port 3000
```

Sign in at `http://localhost:3000/api/auth/signin`. Return to the localhost page
and open DevTools Console. This single-account test intentionally sends three
requests to yourself, which the frozen fake permits. It also sends one request
to a fixture recipient to check you cannot answer someone else's request.

### 2. Paste the helper

Paste this again after any page reload or sign-in/sign-out navigation:

```js
window.api = async (path, body, expected = 200) => {
  const response = await fetch(`/api/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const data = await response.json();
  console.log(path, response.status, data);
  if (response.status !== expected) throw new Error(`Expected ${expected}; got ${response.status}`);
  return data;
};
window.check = (ok, message) => { if (!ok) throw new Error(message); };
```

### 3. Create the test ask and four requests (run once)

If `me` returns 409, complete onboarding using the profile instructions before
continuing. The helper deliberately stops on unexpected status codes.

```js
check(!sessionStorage.getItem("convo.requests-test"), "Test data already exists; resume or clean it up first.");
var me = await api("me");
var ask = await api("refine", { text: "scheduler preemption" });
var test = { owner: me.id, askId: ask.askId, ids: [] };
sessionStorage.setItem("convo.requests-test", JSON.stringify(test));
for (var recipient of [me.id, me.id, me.id, "u_demo_b"]) {
  var sent = await api("requests", { askId: ask.askId, toPersonId: recipient,
    fromUserId: "forged", question: "forged", minutes: 999 });
  test.ids.push(sent.id);
  sessionStorage.setItem("convo.requests-test", JSON.stringify(test));
  check(sent.fromUserId === me.id && sent.toPersonId === recipient, "Wrong participants");
  check(sent.question === ask.refined.text && sent.minutes === ask.refined.minutes, "Wrong question snapshot");
  check(sent.status === "sent" && sent.reply === null && sent.slot === null, "Wrong initial state");
}
console.log("CREATED", test);
```

Expected: six 200 responses (me, refine, four sends), then CREATED; no thrown
error. Keep the ask ID and all four request IDs for cleanup.

### 4. Accept, decline and reply

```js
var test = JSON.parse(sessionStorage.getItem("convo.requests-test"));
var actions = [{ action: "accept" }, { action: "decline" }, { action: "reply", reply: "Use priority classes." }];
var expected = ["accepted", "declined", "answered"];
for (var i = 0; i < 3; i++) {
  var result = await api(`requests/${test.ids[i]}/respond`, actions[i]);
  check(result.status === expected[i], "Wrong response status");
  if (i === 2) check(result.reply === actions[i].reply, "Reply was not saved");
}
```

Expected: three 200 responses with the three statuses above.

### 5. Restart and verify persistence

Stop and restart the same dev server, reload the page, and paste the helper again.
Stay signed in. Session storage survives a reload in this same tab.

```js
var test = JSON.parse(sessionStorage.getItem("convo.requests-test"));
var inbox = await api("inbox");
var expected = ["accepted", "declined", "answered"];
for (var i = 0; i < 3; i++) {
  var item = inbox.find(r => r.id === test.ids[i]);
  check(item?.status === expected[i], "Saved status missing after restart");
  if (i === 2) check(item.reply === "Use priority classes.", "Saved reply missing");
}
check(!inbox.some(r => r.id === test.ids[3]), "Another receiver's request leaked into your inbox");
check(inbox.every(r => r.toPersonId === test.owner), "Wrong inbox owner");
console.log("PERSISTENCE PASSED");
```

Expected: 200 and PERSISTENCE PASSED. The three self-addressed requests appear;
the fixture recipient's request does not.

### 6. Negative checks while still signed in

```js
await api(`requests/${test.ids[3]}/respond`, { action: "accept" }, 403);
await api("requests/missing-request/respond", { action: "accept" }, 404);
await api(`requests/${test.ids[0]}/respond`, { action: "reply", reply: "" }, 400);
await api("requests", { askId: test.askId, toPersonId: "missing-person" }, 404);
await api("requests", { askId: "missing-ask", toPersonId: test.owner }, 404);
```

Expected, in order: 403, 404, 400, 404, 404. These red network entries are expected.

### 7. Signed-out checks

Visit `http://localhost:3000/api/auth/signout` and confirm sign-out. Paste the
helper again, then run:

```js
await api("inbox", undefined, 401);
await api("requests", { askId: "signed-out-test", toPersonId: "u_demo_b" }, 401);
await api("requests/signed-out-test/respond", { action: "accept" }, 401);
```

Expected: all three return 401. Do not sign back in until these checks finish.

### 8. Optional real second-account check

Use a separate browser profile signed into another GitHub account. After it has
signed in to this local app, get its ID from `/api/auth/session` (`user.id`).
In your original signed-in profile, send one request using that ID and your test
ask ID; record its request ID for cleanup. It must appear only in the second
account's inbox. The second account can reply; the original sender gets 403 when
responding. The second account also gets 404 if it sends using your ask ID.
Automated tests already cover this identity separation; this checks two live
GitHub sessions as well. A fixture account cannot substitute for a real login.

### 9. Cleanup only this test data

In the original tab, print `JSON.parse(sessionStorage.getItem("convo.requests-test"))`
and copy its exact ask ID and owner. In Neon SQL Editor, substitute those two
values below. Keep the transaction and owner condition; it does not delete users
or unrelated asks. It also cleans up an optional second-account request tied to
this same ask. No migration or table reset is needed.

```sql
BEGIN;
DELETE FROM requests
WHERE ask_id IN (SELECT id FROM asks WHERE id = 'YOUR_TEST_ASK_ID' AND user_id = 'YOUR_OWNER_ID')
RETURNING id;
DELETE FROM asks
WHERE id = 'YOUR_TEST_ASK_ID' AND user_id = 'YOUR_OWNER_ID'
RETURNING id;
COMMIT;
SELECT id FROM requests WHERE ask_id = 'YOUR_TEST_ASK_ID';
SELECT id FROM asks WHERE id = 'YOUR_TEST_ASK_ID';
```

Both final SELECTs must return zero rows. `RETURNING id` displays the deleted
rows; it is not a separate deletion command. If deletion fails, use ROLLBACK and
report the error; don't broaden the deletion. Only after confirming cleanup:

```js
sessionStorage.removeItem("convo.requests-test");
```

Removing session storage alone never removes database rows.

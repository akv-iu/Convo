# Request screens: manual checks

These checks use only the fake API. No accounts or external services are needed.

## Setup

From the PR #39 worktree in PowerShell:

```powershell
$env:FAKE_API = '1'
$env:FAKES = 'search,ai'
$env:OTEL_SDK_DISABLED = 'true'
npm run dev -- --port 3000
```

Open http://localhost:3000/ask. In DevTools Console, define this helper once per page reload:

```js
window.api = async (path, body, user) => {
  const response = await fetch(`/api/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(user ? { 'x-demo-user': user } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(data)}`);
  return data;
};
```

## Checks and expected results

1. Ask about Kubernetes scheduler preemption, sharpen, and choose **Find people**. A match shows their badge, colour, name, GitHub link, bio, skills and evidence. Hidden country, workplace or hiring answers stay hidden. Highlighting keeps the original evidence text.
2. Send a request, then open **Requests** in the header. Under **You asked**, its chip reads **Sent**, the badge says **Sent to**, and the text says who is expected to answer.
3. In the console, inspect `await api('requests/sent')`. Copy the new request's `id` and `toPersonId`. Reply as its receiver:

   ```js
   await api('requests/REQUEST_ID/respond', {
     action: 'reply', reply: 'Happy to help',
   }, 'RECEIVER_ID');
   ```

   Replace both IDs, then reload Requests. Expect **Replied**, the reply text and the same receiver badge. Define the helper again if needed after reload.
4. Create an incoming request as another fake attendee:

   ```js
   var incoming = await api('refine', {
     text: 'How does Kubernetes scheduler preemption work?',
   }, 'p_003');
   await api('requests', {
     askId: incoming.askId, toPersonId: 'u_demo_a',
   }, 'p_003');
   ```

   Reload Requests. The received card shows **Asked by**, that attendee's badge and the ask type. Reply through the screen: the badge remains after saving.
5. Return to your original matches URL. Turn **Keep people I pass on hidden** off. Clear `sessionStorage` in the console and reload. The question and **Off** setting still load. Choose **Mark as answered**: **Stay in touch** includes the person you sent the request to, even after clearing tab storage. Its GitHub link opens a new tab.
6. Create a fresh ask. In DevTools Network request blocking, block `*/api/asks/*` and reload its matches URL. Cards still load; the saved-setting error offers **Try again**. Unblock, then retry: the switch appears with its saved value.
7. Block `*/api/requests/sent` and reload. Expect a sent-history error, not an empty history. Unblock and use its **Try again**; the error clears and saved recipients are available when resolving.
8. With another fresh ask, use DevTools network throttling. Start a pass or send, then try Search, Show everyone or the switch before it finishes. They wait; holding an arrow key acts once. A failed pass locks its card until **Refresh matches**, rather than submitting the same pass twice.
9. Check both light and dark mode. Tab through the card links and actions; focus stays visible and badges remain readable.

## Cleanup

Stop the fake server with Ctrl+C, remove any DevTools request-blocking rules and turn off throttling. Clear tab storage if desired. Restarting the fake server discards this process's test asks and requests; these checks do not write to Neon or Elasticsearch.

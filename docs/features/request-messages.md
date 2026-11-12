# Feature: Messages to people found by searching

Owner: Person A · PRs: #61

## What it covers

- [x] Screens: on the matches screen, after a search, an open person has a "Message to <name>" box (up to 500 characters) and "Send message"; the recipient sees "Their message" on the request in Requests.
- [x] Contract: `sendRequest` takes an optional `message` (trimmed, at most 500); `Request.message` is optional. Additive; fake and `contract.test.ts` updated.
- [x] Backend: `requests.message` stored and returned with the request.
- [x] Data: `0012_request_message.sql` (adds `requests.message`) applied to Neon.
- [x] Tests: contract tests for carrying, trimming and rejecting a long message.

## How to try it

1. On the preview, ask a question, open the matches and search for something (e.g. a country).
2. Open a person: a "Message to <name>" box shows above the buttons. Write a note and press "Send message".
3. Sign in as that person and open Requests: the request shows "Their message" with the note.
4. Without a search, an open person shows "Send request" and no message box.

## Not covered

Replies to a message; messages without a search (the question itself is the message).

Search by country or workplace, also in this PR's stack, has its own file: `search-by-place.md`.

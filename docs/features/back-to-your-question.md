# Feature: Back to your question

Owner: Person A · PRs: #52

## What it covers

- [x] **Screens:**
  - **Matches:** "Back to your question" now goes to `/ask?ask=<id>`. Without an ask, it's still "Back to Ask".
  - **Ask:** `/ask?ask=<id>` shows that saved question as the current request. It shows this tab's copy at once, then the server's (`GET /api/asks/:id`, already in the contract).
    - **States:** loading, "isn't one of yours" (404 or 401) with an empty box, and a failed load with Try again.
    - **An answered question** gets a note and no Find people.
  - **Send goes straight to the matches** (Aaron's round-5 feedback): the asker chose the wording in the box, sharpened or not, so there's no "Current request" step after sending. That screen is now reached only by reading a question back.
  - The "Press Ctrl+Enter…" hint is gone; the character count stays, and so does the shortcut.
  - "Ask something else" on a question read back takes `?ask=` out of the address, and starts from that question's text. It drops a read-back reply still on its way at once, so that reply can't bring the old question back over a new draft.
  - **No kind-of-question picker** (Aaron): Send carries only the text, and the server gives the default kind. The read-back screen shows the length chip, not a kind chip.
  - After Send, the buttons stay unavailable only while the matches open. Browser Back brings the box back usable.
- [x] **Tests:** Playwright covers:
  - **The round trip:** Send opens `/matches?ask=<id>`, then **Back to your question** shows that question (`/ask?ask=<id>`).
  - **Reading back:** a reload with this tab's copy cleared (so the server is read), someone else's and unknown questions, a failed load then Try again, and an answered question.
  - **Starting again:** after a read-back, **Ask something else** leaves `/ask?ask=` for `/ask`. A late read-back reply doesn't bring the old question back (it fails with the fix removed).
  - **Browser Back after Send** comes back unlocked (it fails on the old lock).
  - **The box:** no kind picker or shortcut hint, and Send carries only the text.
  - **Back links:** `back-links.spec.ts` has the new targets.
- [x] **Docs:** this file.

## How to try it

1. Open **Ask**, type a question and press **Send**. The matches open straight away, with your question at the top.
2. Press **← Back to your question**. You see the same question under "Current request", not an empty box.
3. Reload the page. The question is still there.
4. Press **Ask something else**. The address goes back to `/ask`, and your text stays in the box.
5. Open `/ask?ask=not-a-real-id`. Expect "That question isn't one of yours, or it no longer exists", with an empty box.

## Not covered

- Editing a saved question: there's still no route for it, so changing one means asking again.
- A list of your earlier questions.

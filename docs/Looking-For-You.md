# "People looking for you": who, and "I can help"

**Status: proposal only, not built.** Nothing here changes the API, the
database or the screens. Decide the privacy questions below before building it.

## Goal

At the top of the ask screen, Aaron wants the banner "N people are looking for
someone like you" to open a list of those asks. Each item shows:

- the question;
- its type and length;
- the asker's badge;
- an **I can help** action.

## Today

- `GET /api/looking-for-me` returns only `{ count }`.
- `lookingForMe` (`src/server/requests/lifecycle.ts`) passes the signed-in
  person to `search.whoIsLookingFor` and counts the distinct asker IDs.
- `whoIsLookingFor` (`src/server/search/elastic.ts`) runs a percolate query of
  the person's profile text against the registered open asks
  (`active: true`), leaves out their own asks, and aggregates by `user_id`. It
  returns asker IDs only, up to 1,000, not the asks themselves.
- The count doesn't apply the two-way soft blocker. Someone who passed on you
  with their switch on is still counted.

## Proposed read

`GET /api/looking-for-me/asks` returns
`{ askId, question, type, minutes, person: CardPerson }[]`, newest first and
capped (for example 20).

1. **Search.** Add a search method that returns the matching asks
   (`askId`, `userId`) instead of only counting askers. It's the same percolate
   query with a `top_hits` or plain hits result in place of the `user_id` terms
   aggregation. `whoIsLookingFor` can then be derived from it, so the count and
   the list always agree.
2. **Postgres.** Load those asks in one query (`id IN (...)`), keeping only
   `status = 'open'`. Take the question and minutes from `refined`, falling
   back to `raw_text` and 5 minutes as requests do.
3. **Badges.** Load the askers in one query and pass each through
   `visiblePerson`, so country, workplace and hiring follow their show/hide
   choices. No query runs per item.

## Privacy: decide before building

Askers never chose to show their question to these people. A matched person
would see who is asking what, which the asker may not expect. The options:

- **Per-ask opt-in:** "Let people who can help find this question", shown on
  the ask screen. It's off for existing asks. The list shows only asks that
  opted in, while the count could still include all of them.
- **Question first, asker later:** show the question, type and length without
  the asker's badge. The asker is revealed only when they accept an offer.

Whichever is chosen, the list always leaves out:

- anyone the asker passed on for that ask while its hide switch was on (the
  rule works both ways);
- resolved asks;
- badge fields the asker hid.

The count should apply the same two-way rule, so the number and the list match.

## "I can help"

Requests only go from an asker to someone they picked, carrying the asker's
question. Sending one the other way would break the inbox and "You asked",
which both assume the sender owns the ask. So "I can help" should be its own
thing, an **offer**:

- **Table:** `offers (id, ask_id, helper_id, status, created_at)`, unique on
  (`ask_id`, `helper_id`). Status is `offered`, `accepted` or `dismissed`.
- **Route:** `POST /api/asks/:id/offer`, safe to repeat: a second offer returns
  the first. It returns 404 for a resolved ask, your own ask, or one you can't
  see.
- **For the asker:** offers show in their matches, marked "Offered to help"
  and ranked up, or in Requests. The asker accepts or dismisses each one.
- **Accepting** turns the offer into a normal request (asker to helper, with
  the asker's question), so slots and booking reuse today's flow unchanged.
- **Spam:** a daily cap per helper, for example 10 offers, and one offer per
  ask.

## Open questions

1. Opt-in per ask, or the question without the asker? This affects both the
   list and whether the count changes.
2. Do offers appear in the asker's matches, in Requests, or both?
3. Does the helper learn when an offer is dismissed, or does it just expire?
4. Should offering also count as passing in reverse (the asker can't be shown
   to that helper again)?

## Size and PRD fit

- **Size:** about 1 to 2 days. The parts are the search method, the read
  route, the offers table and migration, the offer route, the list and offer
  screens, and contract, unit and Playwright tests.
- **PRD:** FR-12 (P0) is the counter only, which is built. The nearest
  requirement for this list is FR-16 (P1, asks in the room). This is a P1
  extension, not launch scope.

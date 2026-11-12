# Feature: Find people

Owner: Person A · PRs: #69

## What it covers

- [x] Screens: a Find tab with a search box and example searches; results as badges with skills; "No one shows …" when nothing fits; an error with Try again when the search fails. The matches screen loses its own finder box.
- [x] Contract: `findPeople` (`GET /api/find?q=`, up to 50 `CardPerson`s; empty `q` returns `[]`). Additive; fake and `contract.test.ts` updated.
- [x] Backend: `src/server/requests/find.ts` reads everyone in search, then each signed-up person's saved profile, so only what they show now counts (a real account without a saved profile shows nothing). `src/server/pipeline/find.ts` holds the shared rules (strict: a country, or a workplace, organisation or skill as whole words).
- [x] Tests: `find.test.ts` (saved profile over the search copy, outages), contract tests, and `find.spec.ts` (example search, nothing found, failed search, axe).

## How to try it

1. On the preview, open Find.
2. Tap "Kubernetes": people who show it as a skill or organisation are listed, never you.
3. Search "Spain": only people who show Spain on their badge.
4. Search for nonsense: "No one shows … on their badge."
5. Hide your country on your profile, and from another account search for it: you don't appear.

## Not covered

Paging past the first 50; asking a found person directly (send them a question from Ask).

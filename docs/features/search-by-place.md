# Feature: Search matches by country or workplace

Owner: Person A · PRs: #60

## What it covers

- [x] Screens: the matches search box narrows by a country ("Spain") or a workplace ("University", "Grafana Labs"); a search that finds no one says so ("No one matches your search") and never offers to close the request.
- [x] Backend: `src/server/pipeline/narrow.ts` reads the box; `runMatch` narrows after ranking, using each person's saved visibility (`loadSaved` in `src/server/requests/asks.ts`, the same source as their card), so a hidden country or workplace is never found, even before search catches up. GitHub organisations stay topics. A workplace with a country in its name ("University of Georgia") is the workplace.
- [x] Tests: `narrow.test.ts`, `pipeline/index.test.ts` (index shows the country, saved profile hides it), and `matches.spec.ts` for the empty search and empty matches.

## How to try it

1. On the preview, ask a question and open the matches.
2. Type a country someone in the list shows (e.g. "United Kingdom") and press Search: only people showing that country stay.
3. Type part of a shown workplace ("University"): only people showing it stay.
4. Type something nobody matches: the panel says "No one matches your search", with "Show everyone", and no Yes/No about closing the request.
5. Hide your own country on your profile, and from another account search for it: you don't appear.

## Not covered

Searching by GitHub organisation (those names are usually topics, so they stay a topic search).

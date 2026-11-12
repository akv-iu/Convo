# Feature: Match quality

Owner: Person B · PRs: #65

## What it covers

- [x] **Backend:**
  - **Fit:** the "why this person" call also rates each card's fit (strong, partial, none) from their evidence, sending the ask's type too.
    - People rated none are left out, and everyone keeps their rank.
    - With no strong fit, only the 3 nearest show.
    - Cards the AI couldn't judge (fake API, AI unavailable) are never dropped.
  - **Keyword search:** the keyword half of search uses the ask's topic words, with filler such as "roles", "hiring" or "work" removed, and most of them must match. The semantic half still reads the whole question.
  - **Hiring preference:** career asks rank people who show they're hiring higher, and hiring asks the reverse. A hidden hiring flag never changes anyone's rank.
  - **Workplace:** a workplace the person shows on their badge is part of their searchable profile, in both Elasticsearch and memory search.
  - **Ask type:** refinement types "what roles are you hiring for?" as career.
- [x] **Contract:** `MatchResult.fit` is optional: `strong`, `partial`, or absent when not judged.
  - The fake API sets it only for `[demo:nearest]`, which rates everyone partial.
  - The contract test covers both cases.
- [x] **Screens:** when every card is a partial fit, Matches says "No close match. The 3 nearest people" and "No one here works on exactly this…" instead of "N people found". It uses the existing text tokens, so it reads in light and dark mode.
- [ ] **Data:** reindex existing profiles so workplaces become searchable. Run `npm run seed` for synthetic profiles; real people are reindexed when they next save their profile. Until then, "I want to work at Stripe" finds no one at Stripe.
- [x] **Tests:**
  - **Unit:** fit and caching; pipeline fit filtering, the nearest cap and the hiring preference, including hidden flags either way; keyword terms; workplace only when shown.
  - **Contract:** `fit` only when judged.
  - **Playwright with axe:** the "no close match" list, and an ordinary list.
- [x] **Docs:** this file. `scripts/try-search.ts --audit` measures quality.

## How to try it

1. **Audit:** `FAKE_API=0 npm run try-search -- --audit`, with `.env.local`. It runs 16 varied asks through the whole match pipeline.
   - The PostgreSQL, Kubernetes, LLM and Rust asks show on-topic people.
   - Asks no one in the data can answer show 0 to 3 cards, marked as the nearest.
   - Measured 2026-11-09: 99 of 150 cards were off topic before; after, 28 of 54, mostly honest partial fits such as leader-election work for a Raft ask.
2. **In the app,** ask "I want a job in game development". You see no one, or a few people under "No close match", instead of ten unrelated people.
3. **On the fake API,** ask anything with `[demo:nearest]`. The list shows at most 3 people under "No close match".

## Not covered

- **Industry isn't a profile field.** A healthcare employer is found only through words in their evidence.
- **Fit is judged on the top 10 only.** Someone who fits but is ranked below the first 10 can't replace a dropped card.

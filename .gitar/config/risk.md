# How risky a Convo change is

Each person ships features end to end and merges their own PRs, so the risk label tells the author, and the other person when their approval is needed, where to spend attention. Some High-risk changes also need that approval; see `.gitar/rules/needs-approval.md`.

## High risk

- Sign-in, sessions, the GitHub token or source consent (`src/server/auth.ts`, the GitHub profile builder in `src/server/profile/`).
- Ownership checks on asks, rejections, requests, meetings or slots (`src/server/requests/`, `src/server/schedule/`): a mistake lets one user read or change another user's data.
- Anything deciding what other people see about a person: `src/server/profile/visibility.ts`, match results, or a new route that returns another user's profile.
- The shared contract (`src/contracts/routes.ts`, `src/contracts/types.ts`): both people's code depends on it.
- A migration that alters or drops existing columns or rows, or a change to `es/mappings/` (rebuilding an index deletes its data).
- A new or changed OpenAI call, or a search query on the match path: these decide cost per ask and the 2-second match target.

## Medium risk

- New behaviour behind an existing route; screens that submit data; `.github/`, `.gitar/` or `sonar-project.properties` changes.
- An additive migration (new nullable column, new table, new index).

## Low risk

- Copy, styling, docs, fixtures, and changes that only add or fix tests.

# Convo: Hackathon Build Plan

4 November 2026

Two people each run two agents on four separate workstreams, in about 16 hours each before the build day. Every workstream builds against shared contracts and fakes, so it can be tested alone. The parts are joined one connection at a time from Saturday 7 November, and the code is frozen on Sunday 8 November. Repo: [akv-iu/Convo](https://github.com/akv-iu/Convo).

## Who owns what

Person B, the computer engineer, owns everything behind the screens: data, search, AI, sign-in, the database, CI and Dash0. Person A owns the screens the user sees, built with AI agents against a fake API, so A never needs to touch the backend. The API is the only meeting point, and B reviews A's PRs.

| Person | Agent | Workstream | Requirements | Folders it owns |
| --- | --- | --- | --- | --- |
| A | A1 | First screens: sign-in page, consent, onboarding questions, "Here's what we learned about you" card, ask box, refine screen, "N people looking for you" counter | FR-2 (UI), FR-3, FR-4, FR-5 (UI), FR-12 (UI), FR-13 | `src/app/(onboarding)/`, `src/app/(app)/ask/` |
| A | A2 | Match screens: result cards, swipe, batch reject, soft-blocker switch, receiver inbox, slot picker, mark resolved | FR-6 (UI), FR-8 (UI), FR-9 (UI), FR-10 (UI), FR-11 (UI), FR-13 | `src/app/(app)/matches/`, `src/app/(app)/inbox/` |
| B | B1 | Engine: Elasticsearch indices, data loading, synthetic data, hybrid search, percolator, AI refine and explanations, the four-step match | FR-5, FR-6, FR-7, FR-9 (query), FR-12 | `src/server/search/`, `src/server/ai/`, `src/server/pipeline/`, `scripts/seed/`, `es/` |
| B | B2 | App backend: GitHub sign-in and profile builder, ROR lookup, Postgres, request, rejection and slot APIs, OpenTelemetry and Dash0, CI | FR-1, FR-2, FR-8 (rules), FR-10, FR-11 | `src/server/profile/`, `src/server/requests/`, `src/server/schedule/`, `src/app/api/`, `db/`, `src/instrumentation.ts` |

Shared, and changed only by a PR both people approve: `src/contracts/` (API types and the fake API) and `src/components/ui/` (design tokens and base components, which A owns day to day). B looks after every account and key. A also owns the demo script, the pitch, the accessibility (Merge Forward) story and checking that the demo data looks right.

## Architecture

One Next.js app does everything: the screens, the API and the background work. It runs on Vercel, with Neon for Postgres and the Elastic Cloud trial for search. Nobody runs Postgres or Elasticsearch on a laptop; local development uses the same Neon and Elastic as the deployed app, or the fakes.

| Layer | Choice | Why |
| --- | --- | --- |
| App | Next.js 16 (App Router), TypeScript, Tailwind 4, npm | One codebase for every device; the PRD's choice. npm so A installs nothing extra |
| Screens | Server components for pages, client components only for swipe, forms and the free-time grid | Less JavaScript on phones; simpler for agents to get right |
| API | Next.js route handlers under `src/app/api/`, request and response shapes checked with Zod | The one line between A and B; the same schemas validate the fake and the real routes |
| Sign-in | Auth.js v5 with the GitHub provider; the session holds the GitHub token for the profile builder | One click; profile data arrives with it |
| Database | Neon Postgres with Drizzle ORM; schema in `db/schema/`, migrations in `db/migrations/` | Drizzle is plain TypeScript, so agents and Zod share the types |
| Search | Elastic Cloud trial, official `@elastic/elasticsearch` client, mappings in `es/` | PRD's core data layer; indices rebuilt from a script |
| AI | OpenAI with JSON-schema responses; replies cached in a Postgres `ai_cache` table by input hash | Cache survives Vercel's stateless functions |
| Observability | `@vercel/otel` in `src/instrumentation.ts`, exporting OTLP to Dash0; one span per pipeline step | Vercel's supported path for OpenTelemetry |
| Tests | Vitest for unit and contract tests, Playwright for click-through tests, axe for accessibility | Contract tests run against both the fake and the real routes |
| CI | GitHub Actions: lint, type-check, Vitest with coverage; SonarQube Cloud and Gitar added by B on Day 0 | The PRD's quality gates |
| Hosting | Vercel, with preview deployments per PR and `main` as production | Judges sign in on the production URL |

**Switches.** `FAKE_API=1` makes every API route return fixture data from memory, so A's screens work with no accounts at all. `FAKES=search,ai` makes B's real routes use in-memory search or canned AI replies while the real parts are being built. Both are read in one place, `src/server/config.ts`.

**Folders.**

```
src/app/            screens (A) and API routes (B)
src/components/ui/  design tokens and base components (A)
src/contracts/      Zod schemas, API types, fixtures, fake handlers (shared, frozen after C0)
src/server/         search, ai, pipeline, profile, requests, schedule (B)
db/                 Drizzle schema and migrations (B)
es/                 Elasticsearch mappings and the rebuild script (B)
scripts/            seed and try-search (B)
tests/              Playwright and axe (A and B)
```

## Contracts

There are two kinds of contract. **The API contract** is the line between A and B: every screen talks to the backend only through these routes. **Internal interfaces** are the lines between B's two agents. Each has a real version and a fake, and one setting picks which runs, e.g. `FAKE_API=1` for A's screens and `FAKES=search,ai` inside the backend.

**Shared types** (`src/contracts/types.ts`, written as Zod schemas so the fake and real API are checked against the same shapes): `Person`, `EvidenceDoc`, `HardFilters` (country, ROR ID, hiring), `Ask`, `RefinedAsk` (text, type, minutes), `MatchResult` (person, highlights, badges, mutual, explanation, synthetic flag), `Request`, `RequestStatus`, `Slot`.

**API contract** (B writes it on Day 0; A builds every screen against its fake):

| Route | Screen that uses it | What the fake returns |
| --- | --- | --- |
| `GET /api/me`, `PUT /api/me` | Profile card, onboarding | A fixture profile built from GitHub |
| `GET /api/ror?q=` | Workplace search box | 20 saved institutions |
| `GET /api/availability`, `PUT /api/availability` | Free-time entry | The user's saved free times, kept in memory |
| `POST /api/refine` | Refine screen | Canned answers for 10 sample asks |
| `POST /api/match` | Result cards | Fixture results with highlights and badges |
| `POST /api/rejections`, `PUT /api/soft-blocker` | Swipe, switch | Success, stored in memory |
| `POST /api/requests`, `GET /api/inbox`, `POST /api/requests/:id/respond` | Send, receiver inbox | In-memory requests, so two browser windows can play both sides |
| `GET /api/requests/:id/slots`, POST /api/requests/:id/schedule | Slot picker | Up to 3 slots where both people's free times overlap, the first at least 1 hour away; booking one |
| `POST /api/asks/:id/resolve` | Mark resolved | Success |
| `GET /api/looking-for-me` | Counter | A number |

**Internal interfaces** (B only): `ingestPerson`, `searchCandidates`, `registerAsk` / `countLookingFor`, `getAvailability`, `refineAsk`, `explain`, `getExclusions`, `getProfile`.

**Contract tests:** one test file per route or interface runs against both the fake and the real version. When the real version passes the same tests as the fake, swapping it in should not break A's screens.

**Fixtures** (`src/contracts/fixtures/`): 20 hand-checked people with evidence, 10 sample asks with expected top matches, and 2 demo users. The 500 generated profiles only go into Elasticsearch.

## Day 0 setup (Wednesday 4 to Thursday 5 November)

B does the technical setup. A designs the screens and gets comfortable with the coding tools, so A's agents can start straight away once the fake API exists. Nothing else starts until the contracts are merged.

**Person B**

- [ ] Start the Elastic Cloud trial. Check that `semantic_text`, RRF hybrid search and the percolator all work with a 3-document test
- [ ] Create the OpenAI key with a spending limit, the GitHub OAuth app, and the Dash0 trial (send one trace from a hello-world route)
- [ ] Done in the boilerplate: Next.js, TypeScript, Tailwind, Auth.js, Drizzle, Vitest, Playwright and the CI workflow. B runs it once and checks nothing is missing
- [ ] Deploy it to a public URL (e.g. Vercel) with a hosted Postgres (e.g. Neon) and a working GitHub sign-in there
- [ ] Set up CI: lint, type-check, tests with coverage, SonarQube Cloud and Gitar rules in `.gitar/review/`, plus branch protection
- [ ] Done in the boilerplate: shared types, the API contract, the fake API and the /dev/routes page. B reviews them and fills any gaps
- [ ] Set up A's laptop: Claude Code and Codex, two worktrees, `npm run dev` with `FAKE_API=1`, and the test commands

**Person A**

- [ ] Ask the organisers whether code may be written before 9 November
- [ ] Sketch every screen in the core flow at phone and laptop size, including free-time entry and the empty, loading and error states
- [ ] Set the look: colours with AA contrast, type and spacing, then have an agent build `src/components/ui/` from it
- [ ] Write 10 realistic sample asks and the 20 fixture people with B, so fakes look like the real thing
- [ ] Practise the agent loop once on a throwaway screen: brief, run, check in the browser, open a PR

**Together**

- [ ] Walk through A's sketches against B's API contract and fix any gaps, e.g. a screen needing data no route returns
- [ ] Merge the contracts, fakes and fixtures as one PR
- [ ] Write `AGENTS.md` / `CLAUDE.md` with folder ownership, the contract rule and the test commands, so every agent reads the same rules

Done when: the deployed skeleton signs in with GitHub, CI is green on main, and A can open every fake route on their own laptop.

## Workstreams

Each agent builds in this order. The "done when" test proves the part works alone, with fakes standing in for everyone else. For A, "done" is checked by clicking through it in the browser, then by the agent-written Playwright test that does the same clicks.

### A1: First screens

1. Sign-in page with the GitHub button and a consent step per data source
2. Onboarding questions: country, workplace (search-as-you-type on `/api/ror`) and hiring status
3. The "Here's what we learned about you" card: show, edit and save the profile
4. Free-time entry: the user taps the conference time blocks they're free for, shown against the talk schedule. Quick to fill on a phone, and editable later from the menu
5. Ask box, then the refine screen showing the refined question, its type and meeting length, which the user can edit
6. The "N people are looking for someone like you" counter
7. Phone, tablet and laptop layouts; keyboard use and screen-reader labels

Done when: with `FAKE_API=1`, A can go from sign-in to a refined ask at all three screen sizes using only the keyboard; a Playwright test does the same; and an axe accessibility scan passes.

### A2: Match screens

1. Result cards: highlighted evidence, hard-filter badges, the mutual-interest marker, a "synthetic" label, a search box to narrow the list
2. Swipe, with buttons and arrow keys as alternatives
3. Batch reject after N rejections, and the soft-blocker on/off switch
4. Send request, then the receiver inbox: the question up front with accept, decline or a short reply
5. Slot picker after accept, then mark resolved and the social connect prompt
6. Phone, tablet and laptop layouts; keyboard use and screen-reader labels

Done when: with two browser windows on the fake API, one user sends a request and the other accepts, a slot is picked and the ask is resolved; a two-user Playwright test does the same; and the axe scan passes.

### B1: Engine

1. Mappings for `people`, `evidence` and `asks` in `es/`, with a script that rebuilds them
2. `ingestPerson`, and the synthetic data generator: 500 people with evidence, labelled synthetic, and generated free times for each person, loaded through `ingestPerson`
3. `searchCandidates`: RRF hybrid search, hard filters in `bool.filter`, excluded IDs in `must_not`, collapse on `person_id`, highlights, a boost for free-slot overlap
4. Percolator: `registerAsk`, `whoIsLookingFor`, `countLookingFor`
5. `refineAsk` with a strict JSON schema, and `explain` as **one** batched call per result list, both cached by input hash
6. The four-step `runMatch` (understand, search, mutual check, explain), each step in its own span

Done when: contract tests pass against the real cluster; `scripts/try-search.ts "scheduler preemption"` returns grouped, highlighted people in under 300 ms; a new person is searchable within 1.5 seconds; and the 10 sample asks return their expected top people (tests use recorded AI replies, so they cost nothing).

### B2: App backend

1. Auth.js GitHub sign-in, and the profile builder: repos, languages, bio and organisations turned into a `Person` and `EvidenceDoc`s
2. Postgres schema for users, free times, asks, rejections, requests and meetings. Saving free times also updates the person's document in Elasticsearch, so the free-slot boost uses them
3. The real API routes from the contract, calling B1's interfaces (using B1's fakes until they are ready)
4. Rules: batch reject after N, soft blocker on and off, slot finder (first slot where both people's entered free times overlap, never under 1 hour away, skipping times they already have a meeting booked)
5. OpenTelemetry to Dash0: metrics for time per step, tokens and cost per ask, cache hit rate; a dashboard and an SLO of 95% under 2 seconds

Done when: every API route passes the same contract tests as its fake; unit tests cover the slot finder (the 1-hour lockout, no overlap) and the batch-reject rule; 3 saved GitHub API replies turn into the expected `Person`; and one match request shows four spans in Dash0.

## Checkpoints

There are five gates. Nobody moves past a gate until its test passes. At each gate both people sit together for 30 minutes and run the tests live.

| Gate | When | What must pass |
| --- | --- | --- |
| C0 Skeleton | Thu 5 Nov, evening | Deployed sign-in works, CI is green, contracts and fakes are merged, `npm test` passes with fakes only |
| C1 Works alone | Fri 6 Nov, evening | Each of the four "done when" tests passes on main, still using fakes for everyone else |
| C2 Joined | Sat 7 Nov, evening | The fakes are swapped for the real parts one connection at a time (order below), and contract tests pass against the real versions |
| C3 Whole product | Sun 8 Nov, afternoon | On the deployed URL, two real GitHub accounts complete the whole flow; match p95 is under 2 seconds on the Dash0 dashboard; the axe scan passes |
| C4 Freeze | Sun 8 Nov, evening | Demo script rehearsed twice, data checked, a tagged release. After this, only fixes |

**Order for joining the parts at C2.** Swap one connection, run the full test suite, merge, then do the next. If a step breaks, switch that one back to its fake and keep going.

1. B2 to B1, sign-up: a new GitHub sign-in is written to Elasticsearch. Test: sign in, then find yourself with `try-search`
2. B2 to B1, matching: the real `/api/match` calls the real pipeline, with real exclusions. Test: the 10 sample asks return their expected people, and a rejected person disappears from the next search
3. A1 to the real API: the first screens with `FAKE_API` off. Test: A1's Playwright test against the real backend with a test GitHub account
4. A2 to the real API: the match screens with `FAKE_API` off. Test: A2's two-user Playwright test against the real backend
5. Counter and availability: real percolator count and real entered free times. Test: a new sign-up raises another user's counter

Steps 1 and 2 are B's alone. Steps 3 and 4 are done by A and B side by side: A clicks through, B watches the logs and Dash0.

On 9 November, use the build-day time for the Agent0 slow-step fix, polish, any P1 items and rehearsal, not for core features.

## Working rules

- **One git worktree and branch per agent** (`a1/...`, `a2/...`, `b1/...`, `b2/...`). Agents never share a checkout.
- **A's agents may only edit A's folders and `src/components/ui/`.** If an agent says it needs a backend change, A asks B instead of letting it go ahead.
- **B reviews every PR from A's agents** before merging, at least twice a day. A reviews B's PRs only for anything that changes what a screen shows.
- **When CI fails on A's PR**, A first pastes the failure back to the agent. If two tries don't fix it, it goes to B.
- **Contracts are frozen after C0.** A change to `src/contracts/` is its own PR, approved by both, and updates the fake and the contract test together.
- **Tests come with the code.** Each PR includes the tests that prove its step. Tests never call the real OpenAI API.
- **Brief each agent with the same four things:** its workstream section from this doc, the folders it owns, the API routes or interfaces it uses, and its "done when" test. Tell it to stop and ask before editing outside its folders.
- **Daily 15-minute sync:** which gate is next, what's blocked, and any contract change needed.
- **Tools:** A runs one agent in Claude Code and one in Codex, so each can be left to work while A checks the other in the browser. B runs both agents in Codex. `AGENTS.md` is the one rules file both tools read; `CLAUDE.md` just points to it.
- **Budget the 16 hours:** about 4 on Day 0, 6 to reach C1, 4 for joining the parts at C2, and 2 for C3 and C4. If C1 slips past 8 hours, cut A2's slot picker and resolve screens to the simplest version that works.

## Risks and fallbacks

| Risk | Fallback |
| --- | --- |
| B is the bottleneck: two agents to run, all of A's reviews and every account | A takes the demo script, pitch, data checks and accessibility testing. B reviews A's PRs in two fixed slots a day, not on demand |
| A's agents produce code that fails CI or Sonar | Small PRs, one step each; the agent gets the failure first, then B. A2 can slip to C2 without blocking B |
| Organisers say no code before 9 November | Keep accounts, contracts, sketches, fixtures, synthetic data and CI as prep, then run this plan in one day: C1 at 1:00, C3 at 4:30 |
| The Elastic trial's built-in AI model is slow or missing | Make embeddings with OpenAI during ingestion and store them in a `dense_vector` field; RRF still works |
| Explanations break the 2-second target | Return results first and load explanations separately; cache per person and ask |
| GitHub sign-in fails on the deployed URL | Test the OAuth callback at C0; keep a ready-made demo account |
| Joining the parts at C2 overruns | Any connection not joined by Sunday stays on its fake for that part of the demo, and you say so honestly |

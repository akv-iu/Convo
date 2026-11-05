# Convo: Plan of Action

Updated 4 November 2026. The ordered to-do list from now to the build day. The reasoning behind it is in [Build-Plan.md](Build-Plan.md); this file is only what to do, in what order, by whom. Tick things off as you go.

## Step 0: Both of you, tonight (30 minutes)

- [ ] Clone the repo, run `npm install`, copy `.env.example` to `.env.local`, run `npm run dev`
- [ ] Open http://localhost:3000/dev/routes and click a few GET routes; they answer from the fake API
- [ ] Run `npm run lint && npm run typecheck && npm test` and see them pass
- [ ] Read `AGENTS.md` (5 minutes). It is the rules file every agent gets
- [ ] Agree the two daily review slots when B merges A's PRs (suggested: 13:00 and 21:00 MT)

## Day 0: Thursday 5 November

### B, in this order

1. [ ] **Vercel.** Import the repo, set `FAKE_API=1` for now so the first deploy works, deploy. Keep the production URL; it goes in three places below
2. [ ] **Neon.** Create the project, put `DATABASE_URL` in Vercel and `.env.local`, run `npm run db:generate` then `npm run db:migrate`
3. [ ] **GitHub OAuth app.** Callback URL is `<production URL>/api/auth/callback/github`. Put `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET` and a generated `AUTH_SECRET` (`openssl rand -base64 32`) in Vercel. Add a second OAuth app for `http://localhost:3000` for local sign-in
4. [ ] **Elastic Cloud trial.** Create the deployment and an API key, put `ELASTICSEARCH_URL` and `ELASTICSEARCH_API_KEY` in Vercel and `.env.local`, run `npm run es:rebuild`. Then the three checks from the PRD: index 3 documents with a `semantic_text` field, run one RRF hybrid query, register one percolator query and match it. If `semantic_text` or ELSER is unavailable on the trial, note it and plan for the `dense_vector` fallback in Build-Plan.md
5. [ ] **OpenAI.** Create the key with a spending limit, put `OPENAI_API_KEY` in Vercel and `.env.local`
6. [ ] **Dash0.** Start the trial, put `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS` in Vercel, hit any route on the deployed app and confirm a trace arrives
7. [ ] **Branch protection on `main`.** Require the CI checks and one review. Confirm the Actions run on the boilerplate is green
8. [ ] **A's laptop.** Claude Code and Codex installed, two worktrees (`git worktree add ../convo-a1 -b a1/screens`, same for a2), `npm run dev` working in each with `FAKE_API=1`
9. [ ] **Sonar and Gitar** (last; can slip to Saturday). SonarQube Cloud on the repo, Gitar GitHub App installed, rules in `.gitar/review/`

### A, in parallel

1. [ ] **Ask the organisers** whether code may be written before 9 November, if not already confirmed in writing
2. [ ] **Sketch every screen** at phone and laptop size, on paper or in any tool: sign-in, consent, three onboarding questions, profile card, free-time grid, ask box, refine screen, result cards, swipe, inbox, slot picker, resolved. Include the empty, loading and error state of each
3. [ ] **Set the look.** Pick the colours, type and spacing. The tokens live in `src/app/globals.css`; brief an agent to update them from your sketches and to extend `src/components/ui/` with Card, Input, Badge and Toggle to match
4. [ ] **Fixtures with B** (1 hour together). Grow `src/contracts/fixtures/index.ts` to 20 people and 10 sample asks that look like the real conference. Each sample ask names its expected top person; the contract test checks it
5. [ ] **Practise the agent loop once** on a throwaway screen: paste the A1 brief below, let it build step 1, check it in the browser, open a PR, see CI run, close the PR without merging

### Together, Thursday evening: checkpoint C0

- [ ] Walk A's sketches against `src/contracts/routes.ts`. Any screen that needs data no route returns becomes a contract change, done now in one PR by both of you
- [ ] Merge the fixtures PR
- [ ] C0 passes when: the deployed URL signs in with GitHub, CI is green on `main`, and A can open every fake route on their own laptop

## Friday 6 November: checkpoint C1, each part works alone

Each of you runs two agents, each in its own worktree, each briefed with the text below. Agents open one PR per numbered step of their workstream in Build-Plan.md. B merges A's PRs in the two review slots. Nobody edits outside their folders.

- A1: steps 1 to 4 (sign-in, onboarding, profile card, free-time entry). Steps 5 to 7 if time allows, else Saturday morning
- A2: steps 1 to 4 (result cards, swipe, batch reject, inbox). Step 5 (slot picker, resolve) Saturday morning
- B1: steps 1 to 4 (indices, ingest and synthetic data, hybrid search, percolator), then 5 and 6
- B2: steps 1 to 3 (sign-in and profile builder, schema, real routes), then 4 and 5

C1 passes, Friday evening, when the four "done when" tests in Build-Plan.md pass on `main`, each still using fakes for everything else.

## Saturday 7 November: checkpoint C2, join the parts

Follow the five-step order in Build-Plan.md, one connection at a time, full test suite between each. Steps 1 and 2 are B's; 3 and 4 are A and B side by side; 5 is B's. If a step breaks, switch that one back to its fake and keep going. C2 passes when every contract test passes against the real handlers and `FAKE_API` is off on the deployed URL.

## Sunday 8 November: checkpoints C3 and C4

- [ ] Afternoon, C3: with two real GitHub accounts on the deployed URL, run the whole flow. Dash0 shows match p95 under 2 seconds. The axe scan passes
- [ ] Write the demo script (A): sign in live, state an ask, show the evidence cards, send, accept on the second phone, book the slot, resolve. Under 4 minutes
- [ ] Rehearse it twice, once on a phone
- [ ] Evening, C4: tag `v0.1.0`. After this, fixes only

## Monday 9 November: build day (Mountain Time)

| Time | What |
| --- | --- |
| 11:00 to 1:00 | Agent0: find the slowest pipeline step in Dash0, fix it, keep the before and after. Any P1 item that is cheap |
| 1:00 to 2:30 | Lunch and the panel |
| 2:30 to 4:30 | Polish from rehearsal notes; load the 500 synthetic profiles if not already; check the data looks right |
| 4:30 to 5:30 | Final rehearsal, submission |
| 5:30 | Submissions close |

## Agent briefs

Paste one of these as the first message to each agent, in its own worktree. Replace `<step>` with the numbered step you want built.

### A1 brief

```
You are building the first screens of Convo. Read AGENTS.md first, then the "A1: First screens" section of docs/Build-Plan.md and the API contract in src/contracts/routes.ts.

You own only src/app/(onboarding)/, src/app/(app)/ask/ and src/components/ui/. Do not edit anything else; if you need a change elsewhere, stop and tell me what and why.

The backend is not built. Run with FAKE_API=1 and call the API only through the routes in the contract. The types are in src/contracts/types.ts.

Build step <step> of the A1 list. Server components by default; "use client" only where there is interaction. Phone first, then laptop. Keyboard reachable, with labels for screen readers. Use the tokens in src/app/globals.css and the components in src/components/ui/; never raw colours.

When it works, add a Playwright test in tests/e2e/ that clicks through what you built, run npm run lint, npm run typecheck, npm test and npm run test:e2e, and open a PR with a plain description of what changed. One step per PR.
```

### A2 brief

```
You are building the match screens of Convo. Read AGENTS.md first, then the "A2: Match screens" section of docs/Build-Plan.md and the API contract in src/contracts/routes.ts.

You own only src/app/(app)/matches/, src/app/(app)/inbox/ and src/components/ui/. Do not edit anything else; if you need a change elsewhere, stop and tell me what and why.

The backend is not built. Run with FAKE_API=1 and call the API only through the routes in the contract. To act as the second demo user, send the header x-demo-user: u_demo_b. The types are in src/contracts/types.ts.

Build step <step> of the A2 list. Swipe must also work with buttons and arrow keys. Show the "synthetic" badge on synthetic profiles. Phone first, then laptop. Keyboard reachable, with labels for screen readers. Use the tokens in src/app/globals.css and the components in src/components/ui/; never raw colours.

When it works, add a Playwright test in tests/e2e/ that clicks through what you built, run npm run lint, npm run typecheck, npm test and npm run test:e2e, and open a PR with a plain description of what changed. One step per PR.
```

### B1 brief

```
You are building the engine of Convo: Elasticsearch, the AI calls and the match pipeline. Read AGENTS.md first, then the "B1: Engine" section of docs/Build-Plan.md.

You own only src/server/search/, src/server/ai/, src/server/pipeline/, scripts/ and es/. The interfaces you implement are SearchService in src/server/search/index.ts and AiService in src/server/ai/index.ts; the in-memory versions next to them show the expected behaviour. Do not change src/contracts/ without asking.

Build step <step> of the B1 list. Elasticsearch: hybrid search with RRF over the evidence index, hard filters in bool.filter, excluded ids in must_not, collapse on person_id, highlights returned on each hit. OpenAI: JSON-schema responses, one batched call for explanations, every call cached by a hash of its input in the ai_cache table. Each pipeline step stays in its own span named match.<step>.

Tests never call Elasticsearch or OpenAI: use the in-memory search and recorded replies. Run npm run lint, npm run typecheck and npm test, and open a PR with a plain description. One step per PR.
```

### B2 brief

```
You are building the app backend of Convo: sign-in, the database and the real API routes. Read AGENTS.md first, then the "B2: App backend" section of docs/Build-Plan.md and the API contract in src/contracts/routes.ts.

You own only src/server/profile/, src/server/requests/, src/server/schedule/, src/server/real.ts, src/server/auth.ts, src/app/api/, db/ and src/instrumentation.ts. Do not change src/contracts/ without asking.

Build step <step> of the B2 list. The real handlers live in src/server/real.ts and start as notImplemented; replace them one route at a time. The fake handlers in src/contracts/fake/handlers.ts show the exact behaviour each route must have. When a real handler is ready, add it to the implementations list in src/contracts/fake/contract.test.ts so the same tests run against it. Use FAKES=search,ai until B1's parts are ready.

Keep handlers thin: parse, call a service, return. Tests never call Postgres directly; use the fakes or a transaction that rolls back. Run npm run lint, npm run typecheck and npm test, and open a PR with a plain description. One step per PR.
```

## If something slips

- B's Day 0 overruns: Sonar and Gitar move to Saturday; everything else stays
- C1 slips past Friday: A2's slot picker and resolve screens become the simplest version that works
- An Elastic feature is missing on the trial: the fallback for each is in the Risks table of Build-Plan.md
- A connection will not join by Saturday night: it stays on its fake for the demo, and you say so in the pitch

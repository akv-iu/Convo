

https://github.com/user-attachments/assets/b6372eda-da63-4eab-957c-1d2029497a13

# Convo

[![Quality Gate](https://sonarcloud.io/api/project_badges/measure?project=akv-iu_Convo&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=akv-iu_Convo)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=akv-iu_Convo&metric=coverage)](https://sonarcloud.io/component_measures?id=akv-iu_Convo&metric=coverage)
[![CI](https://github.com/akv-iu/Convo/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/akv-iu/Convo/actions/workflows/ci.yml)

Outcome-driven networking for conferences. State a specific question or goal, see the few people in the room with evidence they can help, and book a short, focused conversation.

Built for the Cloud Native Hackathon, Salt Lake City, 9 November 2026. See [docs/Hackathon-PRD.pdf](docs/Hackathon-PRD.pdf) for the product and [docs/Build-Plan.md](docs/Build-Plan.md) for who builds what.

## Run it

```bash
npm install
cp .env.example .env.local   # FAKE_API=1 is already set
npm run dev
```

Open http://localhost:3000. With `FAKE_API=1` every API route answers from memory, so nothing else is needed. [/dev/routes](http://localhost:3000/dev/routes) lists the whole API contract and lets you try each route. Send the header `x-demo-user: u_demo_b` to act as the second demo user.

## Check it

```bash
npm run lint        # ESLint
npm run typecheck   # TypeScript
npm test            # Vitest: unit and contract tests
npm run test:e2e    # Playwright: click-through tests at phone and laptop size, plus an axe scan
```

## Quality gates

Every change reaches `main` through a pull request that must pass these checks ([how it works](docs/Quality-Gates.md)):

1. **CI**: lint, type-check, unit and contract tests with coverage, then Playwright click-through tests with an axe accessibility scan.
2. **SonarQube Cloud**: the quality gate on new code (coverage, duplication, bugs, vulnerabilities, security hotspots). A failed gate fails CI, and a report step lists the exact files and lines.
3. **Gitar**: AI review against the project's own rules in [`AGENTS.md`](AGENTS.md) and [`.gitar/review/`](.gitar/review/), with a risk level from [`.gitar/config/risk.md`](.gitar/config/risk.md). Repository rules in [`.gitar/rules/`](.gitar/rules/) post checklists when a PR changes the shared API contract, adds a migration, needs the other person's approval, changes a search mapping or adds an environment variable.
4. **Feature sign-off**: each of us merges our own PRs without waiting, unless a PR completes a feature (its checklist in [`docs/features/`](docs/features/)) or Gitar marks it as needing the other person; then it waits for their approval.
5. **Fixes stay honest**: Gitar can push fixes for review findings and CI failures, Sonar's included, but only within [`.gitar/config/apply.md`](.gitar/config/apply.md) and never by weakening a test or silencing a check ([`keep-the-gates-honest.md`](.gitar/instructions/keep-the-gates-honest.md)).

## Stack

Next.js (App Router), TypeScript, Tailwind. Auth.js with GitHub. Neon Postgres with Drizzle. Elastic Cloud for search and matching. OpenAI for ask refinement and explanations. OpenTelemetry to Dash0. Deployed on Vercel. The reasons are in the plan's Architecture section.

## AI disclosure

We build Convo with AI coding assistants (Claude Code and Codex) working under the rules in [AGENTS.md](AGENTS.md), and AI review (Gitar) on every pull request. The two of us direct the work, review it and merge every change.

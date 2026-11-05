# Convo

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

## Stack

Next.js (App Router), TypeScript, Tailwind. Auth.js with GitHub. Neon Postgres with Drizzle. Elastic Cloud for search and matching. OpenAI for ask refinement and explanations. OpenTelemetry to Dash0. Deployed on Vercel. The reasons are in the plan's Architecture section.

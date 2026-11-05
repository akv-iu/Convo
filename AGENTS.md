# Rules for agents working on Convo

Read this before writing any code. The plan in `docs/Build-Plan.md` says what each workstream builds and when it is done.

## Folder ownership

Edit only the folders your workstream owns. If you need a change elsewhere, stop and say so; do not make it.

| Workstream | Owns |
| --- | --- |
| A1 (first screens) | `src/app/(onboarding)/`, `src/app/(app)/ask/` |
| A2 (match screens) | `src/app/(app)/matches/`, `src/app/(app)/inbox/` |
| A1 and A2 | `src/components/ui/`, `tests/e2e/` |
| B1 (engine) | `src/server/search/`, `src/server/ai/`, `src/server/pipeline/`, `scripts/`, `es/` |
| B2 (app backend) | `src/server/profile/`, `src/server/requests/`, `src/server/schedule/`, `src/server/real.ts`, `src/server/auth.ts`, `src/app/api/`, `db/`, `src/instrumentation.ts` |
| Both people, by PR | `src/contracts/`, `.github/`, this file |

## The contract rule

`src/contracts/` is the line between the screens and the backend. `routes.ts` lists every API route with its request and response schema; `types.ts` holds the shared types; `fake/` is the in-memory implementation. These are frozen after checkpoint C0. A change needs a PR approved by both people and must update the fake and `contract.test.ts` in the same PR.

Screens call the API only through the routes in `routes.ts`. The backend implements `src/server/real.ts` so that the contract tests pass for the real handlers exactly as they pass for the fake.

## Switches

- `FAKE_API=1`: every API route answers from the fake. A's default. No accounts needed.
- `FAKES=search,ai`: the real routes use in-memory search and canned AI. B's default while the real parts are being built.
- Both are read in `src/server/config.ts` and nowhere else.

## Before you open a PR

```
npm run lint && npm run typecheck && npm test
```

Playwright (`npm run test:e2e`) for anything that changes a screen. Tests come with the code: a PR for a step includes the tests that prove it. Tests never call OpenAI, Elasticsearch or Postgres; use the fakes or recorded replies.

## Conventions

- TypeScript strict, no `any`. Server components by default; `"use client"` only where there is interaction.
- Keep API handlers thin: parse, call a service in `src/server/`, return.
- Cache AI calls by input hash. Never call an AI or search service in a loop when one batched call will do.
- Every pipeline step runs in its own OpenTelemetry span named `match.<step>`.
- Plain, specific commit messages: what changed and why, no prefixes.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

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
| Both people, by PR | `src/contracts/`, `.github/`, `.gitar/`, `sonar-project.properties`, `vitest.config.mts`, this file |

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

## Quality gates

`main` is protected: changes arrive by PR, and four checks must pass: `Lint, types, tests`, `Click-through (fake API)`, `SonarCloud Code Analysis` and `Gitar`.

- **SonarQube Cloud** applies the default "Sonar way" gate to new code: at least 80% test coverage, at most 3% duplication, no new bugs or vulnerabilities, a maintainability rating of A (fix-up effort under 5% of the new code), and every security hotspot reviewed. Coverage and duplication count once a PR has 20 or more new lines. Screens are excluded from coverage because Playwright tests them. When the gate fails, the `Why the quality gate failed` CI step lists the conditions, issues and files with untested lines.
- **Gitar** reviews every PR against this file and `.gitar/review/`, runs the rules in `.gitar/rules/`, and explains CI failures. Fix blocking findings or reply to them with the reason. Comment `gitar auto-apply:on` to let it push fixes within `.gitar/config/apply.md`. Never use the `gitar-skip` label to get past a review.
- Never silence a gate to get a merge: see `.gitar/instructions/keep-the-gates-honest.md`.
- Stacked PRs (based on another branch) get CI and Gitar but no Sonar scan. After one is retargeted to `main`, push a commit so the Sonar check runs.

## Review and handoff

- When reviewing Person A's PR, inspect the code, contracts and feature behaviour. Use the contributor's checks and current CI results; do not rerun lint or build locally just for that review.
- When making code changes, test and critically review them twice: fix findings from the first pass, then retest and check for regressions in the second. The checks above still apply to your own changes.
- Supply the complete manual test checklist at once, including setup, expected results and cleanup. Ask before tests that contact live external services.
- Clearly signal when work is ready for review or merge. A contract change still needs both people's approval before merge.

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

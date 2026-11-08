# Rules for agents working on Convo

Read this before writing any code. `docs/Quality-Gates.md` explains how a change reaches `main`; `docs/Build-Plan.md` is the original plan.

## Who works where

Both people work on screens and backend. Whoever opens a PR owns the whole change: screens, API, contract, backend, data, tests and docs. Name branches `a/<feature>` (Person A) or `b/<feature>` (Person B), and base every PR on `main`.

| Area | Folders |
| --- | --- |
| Screens | `src/app/(onboarding)/`, `src/app/(app)/`, `src/components/ui/`, `tests/e2e/` |
| API and app backend | `src/app/api/`, `src/server/profile/`, `src/server/requests/`, `src/server/schedule/`, `src/server/real.ts`, `src/server/auth.ts`, `db/`, `src/instrumentation.ts` |
| Search and AI | `src/server/search/`, `src/server/ai/`, `src/server/pipeline/`, `scripts/`, `es/` |
| The contract | `src/contracts/` |
| The gates (both people approve changes) | `.github/`, `.gitar/`, `sonar-project.properties`, `vitest.config.mts`, this file |

Shared services: either person applies migrations to Neon (`npm run db:migrate`) and rebuilds or seeds Elasticsearch. Only Person B can set environment variables in Vercel, so ask B before merging a PR that needs a new one.

## Features and approvals

- A new user-facing feature gets a feature file: copy `docs/features/TEMPLATE.md` to `docs/features/<feature>.md` in its first PR. Each PR of the feature ticks what it finished. Bug fixes, refactors, tests and docs don't need one.
- A PR merges once the checks pass; its author merges it (auto-merge is fine). Fix or answer Gitar's findings first.
- The other person must approve a PR only when:
  1. it ticks the last box of a feature file (they try the feature on the preview first);
  2. it makes a breaking contract change (removes or renames a route or field, makes a field required, or changes a status code or meaning);
  3. it adds a migration that drops or rewrites data;
  4. it changes sign-in, sessions, the GitHub token, source consent, or what other users can see about a person;
  5. it is Person A's and needs a new environment variable (Person B sets it in Vercel);
  6. it changes the gates (`.github/`, `.gitar/`, `sonar-project.properties`, `vitest.config.mts`, this file).
- Gitar adds the `needs-approval` label for these. The `Feature sign-off` check waits for an approval from someone other than the author on PRs with that label and on PRs that complete a feature file.

## The contract rule

`src/contracts/` is the line between the screens and the backend. `routes.ts` lists every API route with its request and response schema; `types.ts` holds the shared types; `fake/` is the in-memory implementation. A change updates the fake, `contract.test.ts`, the real handler and every screen that uses it, in the same PR. Additive changes (a new optional field, a new route) need no one else; breaking changes need the other person's approval.

Screens call the API only through the routes in `routes.ts`. The backend implements `src/server/real.ts` so that the contract tests pass for the real handlers exactly as they pass for the fake.

## Switches

- `FAKE_API=1`: every API route answers from the fake. No accounts needed; the default for screen work.
- `FAKES=search,ai`: the real routes use in-memory search and canned AI. The default for backend work without live services.
- Both are read in `src/server/config.ts` and nowhere else.

## Before you open a PR

```
npm run lint && npm run typecheck && npm test
```

Playwright (`npm run test:e2e`) for anything that changes a screen. Tests come with the code: a PR for a step includes the tests that prove it. Tests never call OpenAI, Elasticsearch or Postgres; use the fakes or recorded replies.

## Quality gates

`main` is protected: changes arrive by PR, and five checks must pass: `Lint, types, tests`, `Click-through (fake API)`, `SonarCloud Code Analysis`, `Gitar` and `Feature sign-off`.

- **SonarQube Cloud** applies the default "Sonar way" gate to new code: at least 80% test coverage, at most 3% duplication, no new bugs or vulnerabilities, a maintainability rating of A (fix-up effort under 5% of the new code), and every security hotspot reviewed. Coverage and duplication count once a PR has 20 or more new lines. Screens are excluded from coverage because Playwright tests them. When the gate fails, the `Why the quality gate failed` CI step lists the conditions, issues and files with untested lines.
- **Gitar** reviews every PR against this file and `.gitar/review/`, runs the rules in `.gitar/rules/`, and explains CI failures. Its findings don't block the merge by themselves, so fix blocking findings or reply to them with the reason before merging. Comment `gitar auto-apply:on` to let it push fixes within `.gitar/config/apply.md`. Never use the `gitar-skip` label to get past a review.
- **Feature sign-off** passes at once unless the PR completes a feature file or has the `needs-approval` label; then it waits for the other person's approval.
- Never silence a gate to get a merge: see `.gitar/instructions/keep-the-gates-honest.md`.
- Base every PR on `main`: PRs based on another branch get CI and Gitar but no Sonar scan.

## Review and handoff

- When the other person asks for your approval, inspect the code, contracts and feature behaviour, and try the feature on the preview. Use the author's checks and current CI results; do not rerun lint or build locally just for that review.
- When making code changes, test and critically review them twice: fix findings from the first pass, then retest and check for regressions in the second. The checks above still apply to your own changes.
- Supply the complete manual test checklist at once, including setup, expected results and cleanup. Ask before tests that contact live external services.
- Clearly signal when work is ready for review or merge, and when it needs the other person's approval.

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

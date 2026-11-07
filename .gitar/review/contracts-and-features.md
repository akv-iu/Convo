# Contracts and features

AGENTS.md is the source of truth; these are the checks that matter most in review. Either person may change any folder: whoever opens a PR owns the whole change.

## Shared contract (`src/contracts/`)

- Treat as a blocking issue: a change to `src/contracts/routes.ts` or `src/contracts/types.ts` that does not also update `src/contracts/fake/handlers.ts` and `src/contracts/fake/contract.test.ts` in the same PR.
- Treat as a blocking issue: a contract change that leaves the real handler or a screen using that route or type on the old shape.
- Treat as a blocking issue: a screen (`src/app/(onboarding)/`, `src/app/(app)/`) that calls `fetch` on a path not listed in `src/contracts/routes.ts`, or builds a request body by hand instead of matching the route's Zod schema.
- Flag any change that makes an existing response field required or removes one; older clients and stored records omit new fields. Such a change needs the other person's approval.

## Features (`docs/features/`)

- A new user-facing feature has a feature file, `docs/features/<feature>.md`, copied from `docs/features/TEMPLATE.md` in its first PR. Flag a PR that adds user-facing behaviour without one. Bug fixes, refactors, tests and docs don't need one.
- Each PR of a feature ticks the items it finished. Flag a ticked item with no code or test behind it on this branch or `main`, and feature work the file doesn't mention.

## Switches

- `FAKE_API` and `FAKES` are read only in `src/server/config.ts`. Flag `process.env.FAKE_API` or `process.env.FAKES` anywhere else.

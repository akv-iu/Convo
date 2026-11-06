# Contracts and folder ownership

AGENTS.md is the source of truth; these are the checks that matter most in review.

## Shared contract (`src/contracts/`)

- Treat as a blocking issue: a change to `src/contracts/routes.ts` or `src/contracts/types.ts` that does not also update `src/contracts/fake/handlers.ts` and `src/contracts/fake/contract.test.ts` in the same PR.
- Treat as a blocking issue: a screen (`src/app/(onboarding)/`, `src/app/(app)/`) that calls `fetch` on a path not listed in `src/contracts/routes.ts`, or builds a request body by hand instead of matching the route's Zod schema.
- Flag any change that makes an existing response field required or removes one; older clients and stored records omit new fields.

## Folder ownership

- Treat as a blocking issue: a PR from an `a1/` or `a2/` branch that edits backend folders (`src/server/`, `src/app/api/`, `db/`, `es/`, `scripts/`), or a `b1/` or `b2/` branch that edits screen folders (`src/app/(onboarding)/`, `src/app/(app)/`, `src/components/ui/`). Shared files (`src/contracts/`, `.github/`, `.gitar/`, `AGENTS.md`, root config files such as `vitest.config.mts` and `sonar-project.properties`) are fine from either side.

## Switches

- `FAKE_API` and `FAKES` are read only in `src/server/config.ts`. Flag `process.env.FAKE_API` or `process.env.FAKES` anywhere else.

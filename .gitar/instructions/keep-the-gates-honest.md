# Keep the gates honest

Applies to every fix Gitar makes or suggests: CI failures, SonarQube Cloud findings and review findings. A green check that hides a problem is worse than a red one.

- Fix the cause. Never delete, skip (`.skip`, `.only`, `test.fixme`) or loosen a test or its assertions, and never lower the coverage threshold in `vitest.config.mts`, to make CI pass.
- Never add `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `any` or `// NOSONAR` to silence a finding.
- Never widen `sonar.exclusions` or `sonar.coverage.exclusions` in `sonar-project.properties` to get new code past the quality gate.
- When SonarQube Cloud reports new lines without coverage (the "Why the quality gate failed" CI step lists the files), add tests that assert real results and error cases, not tests that only call the function.
- A failing Playwright test means a screen changed. Fix the screen; change the test's expected text only when the PR deliberately changed that text.
- If the right fix needs a change to `src/contracts/` or a migration, do not make it: comment what is needed and why.
- Never remove the `needs-approval` label, untick a feature file's boxes, or edit `.github/scripts/feature-signoff.mjs` to get a PR past `Feature sign-off`.

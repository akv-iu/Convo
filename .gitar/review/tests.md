# Tests

- Treat as a blocking issue: a PR that adds or changes behaviour with no test proving it. Backend changes need Vitest tests next to the code; screen changes need a Playwright test in `tests/e2e/`.
- Treat as a blocking issue: a test that calls OpenAI, Elasticsearch, Postgres, GitHub or ROR for real. Tests use the fakes, mocks or recorded replies.
- A new real API handler is added to the implementations list in `src/contracts/fake/contract.test.ts`, so the same contract tests run against it.
- Flag tests that only assert a mock was called without checking the result the user would see.

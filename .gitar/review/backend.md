# Backend (`src/server/`, `src/app/api/`, `db/`, `es/`)

- Route handlers stay thin: parse, call a service in `src/server/`, return. Flag database, search or AI calls written directly in a `route.ts`.
- Treat as a blocking issue: any query on `asks`, `requests`, `rejections` or meetings that reads or writes a row by ID without also checking the signed-in user owns it (or, for requests, is the sender or receiver). Status codes for missing and foreign IDs must match the fake handler for the same route in `src/contracts/fake/handlers.ts`.
- Treat as a blocking issue: an AI (OpenAI) or Elasticsearch call inside a loop or `Promise.all` over a list when one batched call would do. Explanations are one call per result list.
- AI calls are cached by a hash of their input in the `ai_cache` table. Flag a new AI call without the cache.
- Every match pipeline step runs in its own OpenTelemetry span named `match.<step>`.
- Postgres is the source of truth; Elasticsearch is a copy. When a write saves to Postgres and then fails to update search, the error must say the save happened and that retrying the same request is safe. Flag code that reports such a failure as if nothing was saved.
- Never send private GitHub data (private emails, private repos) to search, AI or the client; only public data and sources the user consented to.
- Schema changes need a generated migration in `db/migrations/` with its snapshot; flag edits to an already-merged migration file.
- TypeScript strict: flag `any`, non-null assertions on external data, and unchecked `as` casts of request bodies or database rows.

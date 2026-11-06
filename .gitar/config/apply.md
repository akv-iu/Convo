# Auto-apply criteria for Convo

Gitar may push a fix for a review finding only when all of these hold:

- The fix does not touch `src/contracts/`, `db/migrations/`, `src/server/auth.ts`, `.github/` or `.gitar/`. Contract, migration, sign-in and CI changes need a person.
- The fix does not change an API response shape, a status code, or a database query's ownership check.
- The fix is in the folders the PR already edits; it does not reach into the other person's folders (see AGENTS.md).
- The finding is a clear defect or a stated project rule (from AGENTS.md or `.gitar/review/`), not a style preference.

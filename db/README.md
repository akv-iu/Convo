# Database migrations

`schema/index.ts` defines the Postgres schema. Commit generated SQL together with
the snapshot and journal in `migrations/` so another environment can apply the
same changes.

The initial migration creates `users`, `asks`, `rejections`, `requests`, and
`ai_cache`. Availability is stored in `users.free_times`; a booked meeting is
stored in `requests.slot` with status `scheduled`, matching the existing schema.

`0001_profile_revision.sql` adds `users.revision` (integer, not null, default 0).
Profile/availability writes and GitHub login refreshes increment it atomically;
search uses it to ignore out-of-order snapshots. Apply it before enabling the
real profile API on this version. It is additive and preserves existing rows.

`0002_profile_display.sql` adds nullable `users.workplace_name`,
`users.badge_colour` (default `sunflower`) and `users.visibility` (all shown by
default). Apply it before running this version's real handlers. See
[Frontend-Support.md](Frontend-Support.md) for payloads and the complete manual
checklist. This migration has not been applied by the agent.

## Generate and check

`0003_github_evidence.sql` adds the durable public repository snapshot and its
pending-search flag. Apply it before deploying the evidence handlers. See
[GitHub-Evidence.md](GitHub-Evidence.md) for the B1 interface handoff, retry
behaviour and complete manual checklist. The agent has not applied this migration.

Run from the repository root after installing dependencies:

```powershell
npm run db:generate -- --name=describe_the_change
npx --no-install drizzle-kit check
```

These commands run locally without a database connection. Review the generated
SQL before applying it. Do not edit a migration that has already been applied;
generate a new migration for subsequent schema changes.

## Apply to Neon

Set `DATABASE_URL` in the root `.env.local`, then run with Node 20.6 or newer:

```powershell
node --env-file=.env.local ./node_modules/drizzle-kit/bin.cjs migrate
```

Drizzle's CLI runs outside Next.js and does not load `.env.local` automatically.
Node's `--env-file` loads it explicitly. An existing shell `DATABASE_URL` takes
precedence, so check that the shell targets the intended database. In a separate
worktree, pass the path to your existing `.env.local` instead of copying secrets.

When `DATABASE_URL` is already supplied by the environment, use `npm run db:migrate`.
Drizzle records applied migrations in `drizzle.__drizzle_migrations`;
running the migrate command again skips migrations already recorded there.

Migrations are an explicit deployment step; starting or building the app does
not apply them. `FAKE_API=1` does not prevent migration commands from reaching
the database. Automated unit and contract tests continue to use fakes.

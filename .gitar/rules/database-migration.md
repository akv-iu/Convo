---
title: "Database migration checklist"
description: "Remind the author to apply new migrations to Neon before the deployed app uses them"
type: automation
when: "A PR adds a file under db/migrations/"
actions: "Add the migration label and post the deployment checklist as a comment"
---

# Database migration

Neon is shared by local development and the deployed app, and `next build` does not run migrations.

When a PR adds a migration:

1. Add the `migration` label.
2. Post one comment naming the new SQL file(s), stating whether each statement only adds (columns, tables, indexes) or changes or drops existing data, and this checklist:
   - [ ] Migration applied to Neon with `npm run db:migrate` before the deployed app runs this code
   - [ ] Snapshot and `_journal.json` updated in `db/migrations/meta/`
   - [ ] No edits to migrations already merged to main
3. If any statement drops or rewrites data, say so first in the comment.

---
title: "Needs the other person's approval"
description: "Label PRs that finish a feature or change something both people must agree on, so the Feature sign-off check waits for the other person"
type: check
when: "A PR ticks the last open box of a feature file under docs/features/; or makes a breaking change to src/contracts/ (removes or renames a route or field, makes a field required, or changes a status code or what a field means); or adds a migration that drops or rewrites existing columns or rows; or changes sign-in, sessions, the GitHub token, source consent, or what other users can see about a person; or is opened by anyone other than akv-iu and starts reading a new environment variable; or changes .github/, .gitar/, AGENTS.md, sonar-project.properties or vitest.config.mts"
actions: "Add the needs-approval label and post one comment naming which case applies and what the other person should check"
---

# Needs the other person's approval

Each person ships features end to end and merges their own PRs. The other person is needed only in the cases below. The `needs-approval` label makes the required `Feature sign-off` check wait for an approval from someone other than the PR's author. That check also waits on its own when a PR completes a feature file.

When one of these applies:

1. Add the `needs-approval` label.
2. Post one comment naming the case and what the other person should check:
   - **Feature complete** (every box in a `docs/features/` file is ticked): they try the feature on the Vercel preview, following the file's "How to try it" steps. Check each ticked item against the code and tests on this branch and `main`, and list any ticked item with nothing behind it.
   - **Breaking contract change**: name the route or field, and every screen and route that relies on it.
   - **A migration that drops or rewrites data**: name the statements, and how the data could be restored.
   - **Sign-in, consent or privacy**: say who can now see or do what they couldn't before, or the reverse.
   - **A new environment variable in a PR not opened by akv-iu**: name it. Only Person B (akv-iu) can set it in Vercel, and it must be set before merge.
   - **The gates themselves** (`.github/`, `.gitar/`, `AGENTS.md`, `sonar-project.properties`, `vitest.config.mts`): say what becomes stricter or looser.
3. Never remove the label yourself.

These don't need it: an additive contract change (a new optional field or a new route), an additive migration (new columns, tables or indexes), and a search rebuild. Either person handles those alone.

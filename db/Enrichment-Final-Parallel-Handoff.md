# Final enrichment work: two Claude implementation jobs and two light Codex reviews

## Verified starting point

All four backend track heads below are pushed; their worktrees were clean when inspected. Dry merges changed no branch/worktree/main. They identified real integration work, so individual test runs are not combined acceptance.

| Track | Published branch | Inspected commit |
| --- | --- | --- |
| Background execution | b/enrichment-execution | b0c2655 |
| CV upload | b/enrichment-cv-upload | 13d80c9 |
| Cleanup | b/enrichment-cleanup | 2cd44af |
| Discovery API | b/enrichment-discovery-api | 20c7669 |
| Pages 1–2 | b/profile-enrichment-screens | 8eb3f0a |
| Pages 3–4 | b/profile-enrichment-preferences | d6ef30a |
| Page 5 | b/profile-enrichment-review | c157619 |

Known issues to fix, not conceal:

- Execution + CV has a content conflict in src/server/profile/enrichment/state.ts.
- Cleanup + discovery API conflicts in src/server/config.ts and .env.example.
- Discovery's handoff reports a failing runner fixture: recordDiscovery now requires saved identity and the generation returned by reserveDiscovery. Its full suite/typecheck are not green until this fixture is updated.
- Cleanup's handoff reports manual completion retaining private input, plus a stale next_sweep_at that can repeatedly select unchanged rows and starve others. Confirm/fix with regressions.
- Cleanup's documented schedule has a retention/timing limitation. Do not claim the proposed 48-hour physical deletion target is established; validate the actual configured schedule/plan and document any user decision needed.

No live migrations, settings changes or tests are authorized. Source branches stay intact. Every eventual PR targets main and requires the user's approval to create. Sign-in/consent/privacy changes still need the other person's approval before merge. Never weaken gates or tests to get green.

## Claude 1 — integrate and finish the backend

You own implementation and integration for the real backend. Use a new worktree and branch b/enrichment-backend-integration from current origin/main. Read AGENTS.md, docs/Quality-Gates.md, docs/features/profile-enrichment.md and the contract, integration, migrations, runner, execution, discovery-API, CV and cleanup handoffs under db/. Fetch current heads and preserve newer published fixes.

Merge the four backend branches listed above, preferably execution, CV upload, discovery API, cleanup. They contain their earlier development prerequisites; do not redundantly cherry-pick those changes. Resolve conflicts semantically: preserve both CV staging safeguards and execution attempt fencing, and retain all provider/cleanup config entries. Do not reset files wholesale to one side. Keep the sources and commit history intact.

Fix the runner fixture using saveIdentity/reserveDiscovery/recordDiscovery with the correct generation. Fix manual-job private-input retention and stale cleanup deadlines with failing-first regression tests. Preserve private cache purge, cancelled/superseded-worker fencing, read-only owner lookup, immutable numeric GitHub ownership, durable source limits, per-attempt tokens and original/retry text versions. Check start/retry, discovery and upload actually use their real implementations, and that cleanup can run with the feature off.

Own backend runtime, API, backend tests, root configuration/dependencies/build packaging, migration integration and backend handoff docs. Do not edit screens, browser specs or Playwright config; Claude 2 owns those. Coordinate any required shared contract change before implementing it. Keep gates unchanged. Root provider/cleanup settings are yours; Claude 2 must request shared changes from you rather than edit them concurrently.

Validate the committed migration chain against current main; preserve existing committed/applied migration bytes. Regenerate only genuinely conflicting unmerged proposals against the final schema; do not rename snapshots or silently delete backfills. No live application or data resets.

Ensure the CV worker/dependencies are included in a production build; use local Next docs and an explicitly fake, credential-free build environment. No providers may be contacted by tests/build. Investigate actual build failures without changing gates. Verify cleanup's deployment/schedule limits against official documentation and document any gap instead of enabling a different paid service or weakening retention promises.

Run two critical review/test rounds, including lint, typecheck, full unit coverage and the relevant build/migration checks. Fix findings and retest regressions. Update backend docs with the combined results and complete setup/expected/cleanup checklist. Publish an initial backend integration checkpoint as soon as merge conflicts are resolved so Claude 2 can integrate against it, then push follow-up fixes normally. Report READY FOR REVIEW with commit, findings fixed, remaining limitations and proposed PR order. No PR, merge to main, live services or deployment without approval.

## Claude 2 — integrate the five screens and finish the offline journey

You own frontend implementation/integration and browser acceptance. Use a new worktree and branch b/enrichment-flow-integration from current origin/main. Read AGENTS.md, docs/Quality-Gates.md, the feature file and the contract/runner/execution handoffs. Fetch/merge the three frontend branches listed above plus their needed published development prerequisites; use origin/b/enrichment-backend-integration once Claude 1 publishes its checkpoint. Preserve newer pushed frontend fixes.

Do not spend time resolving competing migration histories independently: Claude 1 owns the canonical backend/schema/root-config integration. If pulling a backend checkpoint creates such conflicts, coordinate the base and preserve that canonical history. Both branches are development integrations; no stacked PRs.

Finish this existing flow, without redesigning or adding sources: /signin -> /signin/sources -> /onboarding -> /onboarding/free-time -> /onboarding/profile. Preserve Google/GitHub sign-in separated from import consent; nullable handles; four independent sources; up to four clickable candidates; source skip/off; public-profile link or pasted text; CV upload/paste; badge/visibility; availability; explicit draft approval.

Fix gaps found in the connected screens. Preserve edited bio/expertise through retry and stale-draft reload, retain only still-valid evidence picks, keep new CV excerpts unselected, handle pending synchronization as a successful saved result, and keep hidden-info warnings owner-only. Save onboarding before approval. Refresh/new-tab and returning-account paths must recover state, errors and redirects honestly.

Own screens, screen helpers/tests, tests/e2e/enrichment and frontend handoff docs. Do not edit backend, contracts, migrations, dependencies or root configuration. Use the existing flag-on browser project; request any needed Playwright/shared-config change from its owner and obtain gate approval if applicable. Report backend defects to Claude 1 with a reproducible case rather than fixing its files concurrently.

Run the established flag-off/on fake browser journeys with accessibility checks, and two critical review/test rounds for your changes. Browser tests must remain fixture-backed with unique owners; do not initiate real OAuth or provider calls. Do not call fake passing screens proof of the real backend. Supply the complete eventual two-account/four-source live checklist, clearly labelled unrun and awaiting authorization. Push, report READY FOR REVIEW with results/fixes and backend dependencies. No PR or merge without approval.

## Codex 1 — light migration and deployment-readiness review

Read-only code review, no implementation or broad test reruns. Use a separate branch/worktree b/enrichment-release-audit from current main with the backend integration checkpoint merged when available. Before that checkpoint, inspect the published backend heads listed above and clearly identify the exact hashes reviewed.

Read AGENTS.md, db/Enrichment-Migrations.md, integration/approval/execution/cleanup/discovery handoffs, committed migration journal/snapshots, final schema, config/template, vercel.json and worker packaging. Check original main migrations remain unchanged, new order/backfills are intact, no duplicate numbering/snapshot gaps exist, and settings names match their consumers. Flag cleanup retention/schedule/duration and CV packaging gaps; use the implementation session's check/build results instead of repeating them.

Write only db/Enrichment-Release-Audit.md. Give concrete blockers with file/line, concise exact private setup/apply/verification instructions for the user, and clearly unverified live items. Never read .env.local, request secrets, contact providers/accounts, apply migrations, change gates or approve a PR based only on static review. Push the memo and return at most ten actionable findings. Send backend fixes to Claude 1. No PR or merge.

## Codex 2 — light security and contract review

Read-only targeted review, no implementation or full-suite reruns. Use a separate branch/worktree b/enrichment-boundary-audit; inspect exact published backend/frontend integration checkpoints once available. Start from the listed implementation heads while those checkpoints are being built; identify which conclusions require rechecking afterward.

Read AGENTS.md and the contract/execution/approval/cleanup handoffs. Follow only the changed trust boundaries: cookie owner to numeric GitHub identity; token capture; per-attempt dispatch/lease fencing; owner-bound discovery/CV/job/source identifiers; approval references and text versions; retry/pending synchronization; cancellation/withdrawal/cache purge; cleanup authentication; and public card visibility. Check schema/fake/real/screen expectations agree. Separate confirmed defects from limitations and unperformed live tests.

Write only db/Enrichment-Boundary-Audit.md, at most ten concrete findings with file/line, reproduction, impact and suggested owner. Reuse authors' current checks. Do not rerun lint/build/full tests, call live services, touch secrets, modify runtime/gates or submit a formal approval. Push the memo; route backend findings to Claude 1 and screen findings to Claude 2. No PR or merge.

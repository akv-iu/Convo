# Feature: Profile enrichment with Google or GitHub sign-in

Owner: Person B, coordinated with Person A's frontend/B1 work. PRs: not opened yet.

This tracks the whole feature across the foundation, backend and screens. A checked foundation box is not final feature sign-off.

## What it covers

- [x] Foundation proposal: bounded schemas, owner-scoped fake routes, deterministic failure cases and contract tests.
- [ ] Contract: Claude's ACK, nullable-handle compatibility merged and all checks green on the current main.
- [ ] Authentication: Google/GitHub sign-in, protected explicit GitHub linking, no duplicate/merged accounts or leaked tokens.
- [x] Authentication implementation: provider-subject ownership, session/state-bound GitHub linking, minimal Google scopes and mocked callback tests. Live acceptance remains open.
- [ ] Backend: real source discovery/retrieval, isolated CV processing, durable/recoverable jobs, cached synthesis, approval and withdrawal.
- [x] Private staging/job-state implementation: owner-only answers and pasted CV, durable manual jobs, lease/retry kernel and expiry. Collector/synthesis runner and operational cleanup scheduling remain open.
- [x] Approved-evidence storage implementation: atomic approval/withdrawal, text revisions, all-source indexing, pending-sync retries and source ownership tests. Migration and live acceptance remain open; see [the storage handoff](../../db/Enrichment-Approval.md).
- [x] Internal import runner and synthesis: selected-source collection, partial retry, professional excerpts, lease-fenced cached draft generation and atomic cache erasure. Request wiring, cleanup scheduling and live acceptance remain open; see [the runner handoff](../../db/Enrichment-Runner.md).
- [x] Start/retry execution implementation: real requests schedule the runner with owner-bound credentials, current text revisions and per-attempt callback fencing. Discovery/CV/cleanup integration and live acceptance remain open; see [the execution handoff](../../db/Enrichment-Execution.md).
- [x] Backend integration: execution, CV upload, discovery API and authenticated cleanup merged on one branch, with manual-input retention and stale cleanup-deadline fixes; migration chain and credential-free build checked. Migrations, settings, the retention decision and live acceptance remain open; see [the backend integration handoff](../../db/Enrichment-Backend-Integration.md).
- [ ] Screens: source controls, candidate previews, CV, progress, help, editable bio and nullable-handle display.
- [x] Screens implementation: the five-page flow (/signin, /signin/sources, /onboarding, /onboarding/free-time, /onboarding/profile) behind the switch, on the fake API: four independent sources, up to four candidates, skip/link/pasted text, CV upload or paste, badge and availability, and approval that keeps edits through retries and reloads. Live acceptance remains open; see [the flow handoff](../../db/Enrichment-Flow-Integration.md).
- [x] Search: expertise, reserved-ID protection, cross-route memory state and complete-evidence rebuild recovery (included in the backend integration).
- [ ] Data: reviewed additive migrations applied/verified in the intended Neon environment without resetting shared data.
- [ ] Settings: Google/OpenAlex/Brave/cleanup environment values configured privately by Person B; feature remains off until acceptance.
- [ ] Tests: two review rounds, fake flag-off/on browser coverage with axe, then authorized live two-account/source/removal acceptance.
- [x] Flag-off/on browser coverage: the click-through gate runs ordinary specs on a flag-off fake server and tests/e2e/enrichment on a separate flag-on one (397 passed, 13 existing skips). Live acceptance remains open; see [the browser configuration handoff](../../db/Enrichment-Browser-Config.md).
- [ ] Docs: final account setup, complete manual checklist, retention limits and remaining pilot limitations reviewed.

## How to try it

The complete foundation API-only checklist is in [the contract handoff](../../db/Profile-Enrichment-Contract.md#complete-local-manual-checklist-api-foundation-only). Real enrichment and Google OAuth are not available yet. When the complete feature reaches preview, the final checklist must cover Google-only and GitHub users, all four sources, cancel/retry/expiry, owner isolation, explicit approval, indexing/rebuild and source removal.

## Not covered

ORCID sign-in, automatic account merging/email linking, OCR, private/login-only page retrieval, LinkedIn scraping and full-paper PDF collection.

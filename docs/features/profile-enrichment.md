# Feature: Profile enrichment with Google or GitHub sign-in

Owner: Person B, coordinated with Person A's frontend/B1 work. PRs: not opened yet.

This tracks the whole feature across the foundation, backend and screens. A checked foundation box is not final feature sign-off.

## What it covers

- [x] Foundation proposal: bounded schemas, owner-scoped fake routes, deterministic failure cases and contract tests.
- [ ] Contract: Claude's ACK, nullable-handle compatibility merged and all checks green on the current main.
- [ ] Authentication: Google/GitHub sign-in, protected explicit GitHub linking, no duplicate/merged accounts or leaked tokens.
- [x] Authentication implementation: provider-subject ownership, session/state-bound GitHub linking, minimal Google scopes and mocked callback tests. Live acceptance remains open.
- [ ] Backend: real source discovery/retrieval, isolated CV processing, durable/recoverable jobs, cached synthesis, approval and withdrawal.
- [ ] Screens: source controls, candidate previews, CV, progress, help, editable bio and nullable-handle display.
- [ ] Search: expertise, reserved-ID protection, cross-route memory state and complete-evidence rebuild recovery.
- [ ] Data: reviewed additive migrations applied/verified in the intended Neon environment without resetting shared data.
- [ ] Settings: Google/OpenAlex/Brave/cleanup environment values configured privately by Person B; feature remains off until acceptance.
- [ ] Tests: two review rounds, fake flag-off/on browser coverage with axe, then authorized live two-account/source/removal acceptance.
- [ ] Docs: final account setup, complete manual checklist, retention limits and remaining pilot limitations reviewed.

## How to try it

The complete foundation API-only checklist is in [the contract handoff](../../db/Profile-Enrichment-Contract.md#complete-local-manual-checklist-api-foundation-only). Real enrichment and Google OAuth are not available yet. When the complete feature reaches preview, the final checklist must cover Google-only and GitHub users, all four sources, cancel/retry/expiry, owner isolation, explicit approval, indexing/rebuild and source removal.

## Not covered

ORCID sign-in, automatic account merging/email linking, OCR, private/login-only page retrieval, LinkedIn scraping and full-paper PDF collection.

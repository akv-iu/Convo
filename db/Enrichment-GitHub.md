# Consent-aware GitHub evidence collector

Status: provider-only work on `b/enrichment-github`, based on the reviewed enrichment state/research stack. No sign-in callback, source route, environment value, database or publishing behavior changes. Configuration and route wiring remain deferred by the user. The eventual PR targets main after the foundation dependencies and migrations are integrated.

## Plan and scope

- [x] Add recorded collector tests first: consent combinations, numeric identity, public repositories, bounded source evidence, empty categories and sanitized errors.
- [x] Reuse loadGitHubIdentity/loadGitHubProfile/buildProfile. Add one shared bounded JSON reader used by existing GitHub HTTP requests and the OpenAlex provider; no new dependency or duplicate HTTP-body parser.
- [x] Implement collectGitHubEvidence(owner, accountId, accessToken, selection). Credentials are explicit arguments and never enter jobs, evidence, logs or returned errors.
- [x] Produce a single optional GitHub profile summary (only selected bio/org categories) and highest-star public repository evidence. The source budget is twenty documents: nineteen repos when a summary is present, otherwise twenty. This leaves ten papers, one public page and five CV excerpts within the existing global thirty-six limit.
- [x] Preserve safe request limits and classify revoked access, demonstrated rate limiting, timeout and provider failures without declaring a profile private or blocked.
- [x] Review twice and run lint/typecheck/full tests with coverage on the integrated stack. Prepare the branch for review; PR creation and live testing still require authorization.

The future runner must check the owner's live GitHub connection and job lease, pass the numeric linked account ID and transient credential, recheck consent/generation before saving, and scrub contact/sensitive material before synthesis. Collected evidence remains private and unapproved until acceptance; this module does not write profile fields or index search.

## Collection and limits

An import switched off makes no request. An enabled import verifies the transient token against the linked numeric GitHub account before reading optional endpoints. Renamed handles use the freshly verified login. The bio is retained only when selected; repositories and public organisation memberships each have their own consented endpoint. Unselected fields and private repositories never become evidence.

The existing loader reads the latest 100 public repositories and first 100 public organisations without pagination. Repositories are ordered by stars within that fetched set, deduplicated, and checked against the verified owner and repository name in their HTTPS links. The optional profile summary includes only selected bio/organisation text, capped at 3,000 characters. Counts describe retained evidence; an empty selected import returns github_nothing_public rather than claiming the profile blocked access.

At most three requests run: identity, then the two optional endpoints in parallel. Each has a ten-second timeout and a 1 MiB JSON-body limit. Requests stay on api.github.com and reject redirects. A source fails atomically if any selected endpoint fails; the future runner must preserve other sources independently. Rate limits require HTTP 429 or HTTP 403 with rate-limit headers; ambiguous HTTP 403 is provider_down. Returned errors contain no provider body, credential or cause.

## Verification

The collector has **29 recorded-response tests**. The focused collector, existing GitHub loader and OpenAlex suites pass **96 tests**. A duplicate-repository case failed first, then passed after deduplication was added. An independent read-only review of source a3f89bc found no blockers.

Both complete rounds passed lint, typecheck and **944 tests in 65 files**, with **98.59% line coverage**. These ran against source a3f89bc plus Claude's compatibility 8ee0b3a, which includes main d139e82 and avatars. The shared JSON reader's extraction also passed all existing OpenAlex tests; existing auth/profile callers passed the full regression suite.

For these functional checks only, the temporary merge retained both B2 schema imports and isolated conflicting migration metadata. It was aborted after verification and was not published. That earlier validation merge was not a deployable migration chain. The current branch now includes main 576692d and the regenerated 0007-0009 chain; see Enrichment-Integration.md for fresh verification and Enrichment-Migrations.md for the future live application checklist. No screen code was edited, and Playwright was not run for this provider-only change.

Repeat the focused recorded checks without accounts or credentials:

```powershell
npx vitest run src/server/profile/enrichment/github.test.ts src/server/profile/github.test.ts src/server/profile/enrichment/openalex.test.ts
```

No live GitHub requests, real credentials or database writes were used. At configuration/runner integration time, supply the complete setup, consent combinations, owner-isolation, empty/revoked/error and cleanup checklist together and ask before live tests. End-to-end import, synthesis, acceptance and publication are not established by this module.

## Current main integration

The branch now integrates main 576692d through the regenerated foundation/auth/state chain (0007-0009). Both full rounds pass lint/typecheck and 944 tests in 65 files, 98.59% line coverage; Drizzle check passes. GitHub/OpenAlex provider source/tests and the shared JSON reader are unchanged. This is the combined development base for the other sessions; pending backend work and live acceptance remain explicit in Enrichment-Integration.md.

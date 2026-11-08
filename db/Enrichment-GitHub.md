# Consent-aware GitHub evidence collector

Status: provider-only work on `b/enrichment-github`, based on the reviewed enrichment state/research stack. No sign-in callback, source route, environment value, database or publishing behavior changes. Configuration and route wiring remain deferred by the user. The eventual PR targets main after the foundation dependencies and migrations are integrated.

## Plan and scope

- [ ] Add recorded collector tests first: consent combinations, numeric identity, public repositories, bounded source evidence, empty categories and sanitized errors.
- [ ] Reuse loadGitHubIdentity/loadGitHubProfile/buildProfile. Add one shared bounded JSON reader used by existing GitHub HTTP requests and the OpenAlex provider; no new dependency or duplicate HTTP-body parser.
- [ ] Implement collectGitHubEvidence(owner, accountId, accessToken, selection). Credentials are explicit arguments and never enter jobs, evidence, logs or returned errors.
- [ ] Produce a single optional GitHub profile summary (only selected bio/org categories) and highest-star public repository evidence. The source budget is twenty documents: nineteen repos when a summary is present, otherwise twenty. This leaves ten papers, one public page and five CV excerpts within the existing global thirty-six limit.
- [ ] Preserve safe request limits and classify revoked access, demonstrated rate limiting, timeout and provider failures without declaring a profile private or blocked.
- [ ] Review twice, run lint/typecheck/full tests with coverage on the integrated stack, and push for review. No PR or live test without authorization.

The future runner must check the owner's live GitHub connection and job lease, pass the numeric linked account ID and transient credential, recheck consent/generation before saving, and scrub contact/sensitive material before synthesis. Collected evidence remains private and unapproved until acceptance; this module does not write profile fields or index search.

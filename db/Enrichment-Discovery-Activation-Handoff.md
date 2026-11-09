# Implementation job: activate real discovery behind the feature flag

This replaces the testing-only assignment for the extra Codex window. Implement the authenticated discovery API; do not rewrite Claude's provider/service work.

## Four parallel tracks

1. Claude CV: real PDF/DOCX upload, private staging and upload tests.
2. Claude cleanup: authenticated scheduled expiry endpoint and cleanup configuration.
3. This Codex window: real research/public-profile discovery route wiring, provider configuration and route tests.
4. Primary Codex: start/retry scheduling, owner-bound credential capture and runner integration, then combine all tracks.

## Branch and references

Use a separate worktree and branch `b/enrichment-discovery-api`. Start from current `origin/main`, then merge `origin/b/enrichment-runner` and `origin/b/enrichment-discovery` as development prerequisites. Known implementation bases: runner `acd8cb9`, discovery `4720c5e`. Fetch before starting; preserve newer published work. Do not alter another session's worktree, rewrite prerequisite history or cherry-pick/rename migrations. The eventual PR targets main after prerequisites land; do not open it yet.

Read AGENTS.md, docs/Quality-Gates.md, docs/features/profile-enrichment.md, db/Profile-Enrichment-Contract.md, db/Enrichment-Runner.md and db/Enrichment-Discovery.md. Inspect the real API dispatch, enrichment adapter, discovery service, providers and discovery/state tests before changing code. Read the relevant installed Next.js guide before route changes.

## Implementation

- Replace only `real.discoverEnrichment`'s placeholder with Claude's existing discovery service. Preserve the contract and common adapter's authentication, origin check, size limit, response validation, feature-off behavior and sanitized errors. Remove the placeholder helper only if it has no other callers.
- Supply OpenAlex/Brave credentials from server-only configuration. Add only the OpenAlex/Brave settings and empty template entries; no real values, public-prefixed variables or configuration/deployment changes to accounts. Follow the repository's environment conventions.
- Missing credentials for one source must not disable the other. Return the existing sanitized unavailable outcome for the selected unavailable source; preserve durable attempt accounting and stale-selection protection. Do not replace those with process-local limits or duplicate service logic.
- Preserve one source per discovery request, at most four candidates, human-readable HTTPS links, plain-text snippets and the owner's staged-identity/generation checks.
- Feature off and fake API behavior stay unchanged. Do not enable real imports or call the background runner from discovery.
- Add meaningful API/dispatch tests with mocked providers and persistence. Prove the real route reaches the real discovery orchestration, rather than testing only a mock returning the desired response. Cover auth/origin/flag/fake behavior, independent source keys, ok/no-match/unavailable responses, sanitized failures and stale owner inputs as needed; cite existing tests for cases already established.

## Exact editing boundaries

Own new discovery API test files, a short `db/Enrichment-Discovery-API.md`, the discovery import/entry in `src/server/real.ts`, and discovery-specific configuration/template lines. Prefer new test files to modifying another session's active tests. Preserve the existing discovery implementation unless a concrete integration defect requires a targeted fix; record and communicate it.

Do not edit start/retry handlers, their service functions, runner, synthesis, CV modules/staging, cleanup implementation, auth, screens, gates, dependencies or migrations.

Two files are deliberately shared across separate branches: real.ts (Claude CV owns uploadCv; you own discoverEnrichment) and config.ts/.env.example (Claude cleanup owns the cleanup secret; you own the two discovery keys). Keep edits restricted to those entries, avoid whole-file formatting, and report the exact fields changed. The primary window will merge the tracks sequentially and resolve any adjacent-line conflicts while preserving both. The primary window will not independently add the discovery settings.

## Verification and finish

Use mocks/recorded responses only. No Brave/OpenAlex/ROR/page requests, paid calls, database connections, migrations, environment/account changes or live deployment. Test and critically review twice, fix first-round findings, then rerun and check regressions. Run lint, typecheck and unit tests with coverage for your changes. A backend-only task does not require new browser tests.

Document setup, expected results and cleanup together, plus the private settings the user will eventually configure. Push your branch and report READY FOR REVIEW with commit, implementation scope, results, exact shared-file edits, findings and limitations. No PR creation or merge without approval; this task does not complete the feature or authorize enabling the flag.

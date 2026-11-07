# Profile enrichment: shared delivery brief

Status: Google/GitHub authentication and four independent imports confirmed; revised foundation is a proposal awaiting Claude's CONTRACT ACK. Real enrichment is not implemented. Owner: Person B. Updated: 7 November 2026, America/Denver.

This is the shared context for the user's separate Codex and Claude sessions. Read it together with `AGENTS.md`, `docs/Build-Plan.md` and `docs/Quality-Gates.md`. The user requested frontend and backend delivery of the complete bounded feature below. Existing folder ownership and approval rules still apply. This document proposes the API; it does not freeze or approve a contract change by itself.

## 1. What we are building

The user first enters their basic details and chooses permitted sources. On page two they sign in with Google or GitHub, preview possible research/public-profile matches, confirm the links that belong to them, optionally upload a CV, and can turn sources off again. Continuing starts collection and synthesis while they finish badge and availability choices. The user reviews and edits the resulting evidence-backed bio before it replaces their public profile.

Confirmed decisions from the user: Public/university profile is a separate fourth source permission. Authentication with Google or GitHub is required; GitHub data import is optional. No ORCID sign-in. A Google-only attendee needs no GitHub account. This details-first, source-confirmation-second flow supersedes the earlier sign-in-first recommendation in this document. Do not move authorization ahead of page one or combine public-profile permission with Research/CV. The 7 November Google/GitHub decision supersedes every earlier GitHub-only instruction.

Four optional data sources ship together:

| Source | First-release behavior |
| --- | --- |
| GitHub | Existing public bio/repository/language/organisation permissions. GitHub is an optional authentication/connection provider on page two; importing its optional data happens only when still selected at final source confirmation. |
| Research | OpenAlex API; prefer an optional ORCID, otherwise search using confirmed name and workplace/ROR. Show up to four author candidates with affiliations, sample papers and clickable links; require a selection or Skip. Import up to ten papers from the selected author. |
| Public professional profile | Use a supported search API to find candidates from name and workplace. Show **at most four** deduplicated candidates with title, visible domain, plain-text snippet and clickable HTTPS URL. Select one, choose None of these, or provide a URL. Fetch the chosen page only. |
| CV | One text-based PDF or DOCX, at most 2 MiB. Extract plain text, show filename/result/warnings, and allow replacement/removal. Support pasting CV text as the fallback for scans or unreadable files. |

Interpretation of the user's four-profile limit: four search candidates, with **one confirmed public-profile page per run**, initially unselected. An external link opens the actual page in a new tab with `noopener noreferrer`; opening it does not select it. Search results are suggestions, not verified identities. No result is selected automatically.

Scanned PDFs requiring OCR, encrypted documents, old `.doc` files, private/login-only pages, LinkedIn scraping, recursive website crawling and arbitrary file downloads are outside this release. CV and LinkedIn must no longer be presented as one working capability: label the working option CV upload, with LinkedIn import remaining separate. Optional ask sharpening, five-minute meetings, ask lists and changed blocker defaults are separate proposals; do not bundle them here.

## 2. Current code and coordination baseline

- Latest main at this revision: `1f763c7`; #44, #45 and #46 are merged. Initial planning used `dde538d`; do not use the stale local main in D:/Projects/Convo as a branch base.
- Claude's `a1/nullable-handle` commit `ad0c26f` is prepared on #44's head and remains a foundation dependency. Review/push/merge it separately; Codex changes no screen files. Validate against the current merged main, not the old branch snapshot.
- Main now has five quality checks, including Feature sign-off, and a feature-checklist requirement. User instructions still require approval before opening this feature's PR or merging it. No feature is marked complete while real OAuth/imports/UI/live acceptance are pending.
- `src/server/profile/github.ts` imports the consented public metadata. `buildProfile()` currently copies the existing GitHub bio; it does not write one with AI.
- `initializeGitHubProfile()` currently imports and saves GitHub evidence in the sign-in callback, preserving edits on repeated sign-in. With the feature enabled, separate minimal identity persistence from optional imports: authenticate and return to page two first, then collect GitHub source data only after the user's final Continue. Optional import failure must not deny authentication. Keep the legacy flow when the feature is off. Do not put discovery, CV parsing or AI synthesis into the authentication callback.
- `syncProfile()` currently accepts only up to 20 repo evidence records from `users.githubEvidence`. Merely adding papers to that column will fail validation. General evidence storage, validation, sign-in preservation, pending filtering and rebuild recovery all need updating together.
- Existing `users.revision` protects search ordering. `scripts/seed.ts` already replays real users through `syncProfile(user, elasticSearch)`; retain that path and test it with every new source.
- Existing `Person.languages` means programming languages. Add a separate bounded `expertise` field for professional/research topics; do not put research subjects into `languages`.
- Search reserves the internal kind `profile` for its generated profile document. Use a different evidence kind, such as `profile_page`, for a collected page. Existing `paper` can represent publications; a new `cv` kind represents only user-approved professional excerpts.

## 3. User journey

1. **Page one - Details and permissions:** name (at most 80), country, typed workplace and optional ORCID; four independent import controls. Keep unsaved safe answers across authentication. Pilot proposal: directory/ROR confirmation is offered after sign-in, because /api/ror is authenticated; name/workplace matching can start with a null ROR ID.
2. **Page two - Sign in, connect and confirm:** Google or GitHub, returning to this same page. Authentication does not start optional imports. Google-only users need no GitHub unless they select its import; Connect GitHub attaches it to the existing account. Refuse already-owned connections; cancel/deny/reconnect returns here without discarding selections or switching the owner. After authentication, privately save page-one identity through PUT /api/profile-enrichment so another tab can resume before final Continue. Discover Research and Public profile independently. Each has at most four clickable candidates, no automatic selection, one confirmed choice or Skip. Public profile also allows a different HTTPS URL or at most 30,000 pasted characters. CV accepts a PDF/DOCX or pasted text and can be replaced/removed. All controls remain editable.
3. **Page three - Badge:** Final Continue snapshots confirmed sources and starts import/synthesis, while hiring, colour and visibility are chosen. All sources off returns manual mode without AI. Synthesis omits country/workplace/hiring claims regardless of later display choices.
4. **Page four - Availability:** save free time while the job runs. Poll only active jobs; show stalled/partial/failure honestly and provide explicit retry.
5. **Page five - Review:** proposed bio/expertise, linked supporting excerpts, source snapshots and warnings. CV excerpts start unselected. Allow editing, removing wrong evidence and manual continuation. Generated bio is not published until approved. Preserve newer text edits and current badge/time settings. A returning user can keep their accepted profile without enrichment.

The four sources only decide what fills the Lanyard profile. ORCID helps OpenAlex lookup and is not authentication or proof of authorship. Nothing is written to OpenAlex/ORCID/GitHub.

## 4. Concrete implementation proposal

### Discovery and retrieval

- Research and public-page discovery are separate choices and separate result lists, each capped at four candidates. Reconfirm candidates if page-one identity/workplace changes. No data is scraped from an unselected candidate, and changing a source to off invalidates in-flight results and removes its unaccepted input. A UI toggle never signs the user out of GitHub.
- Source jobs obtain any required GitHub credential server-side from the existing encrypted auth session; never expose it through the public session, source API, job table, cache or logs. Do not persist a new plaintext token store. A retry without a valid provider credential asks the user to reconnect, then returns to page two with their safe selections intact.
- Use OpenAlex's current API, with a server-only `OPENALEX_API_KEY`. Resolve institution IDs from ROR when available. ORCID and name/affiliation signals help locate candidates but do not replace user confirmation or prove account ownership. Affiliation history is not automatically the current workplace.
- Proposed public-web discovery provider: Brave Web Search, with server-only `BRAVE_SEARCH_API_KEY`. Use a bounded name/workplace query, prefer the confirmed organisation's domain, deduplicate canonical URLs, and return at most four eligible results. Provider failure returns an unavailable status and manual URL fallback. Do not scrape Google search HTML or treat a search snippet as biographical evidence.
- Show a candidate ID in the API, not a trusted client-supplied copy of search text. Bind the saved candidate set to the signed-in owner and input fingerprint; reject stale candidate IDs after name/workplace changes. Revalidate the chosen URL at fetch time.
- Public-page fetching accepts HTTPS only and no credentials. Block non-public IPv4/IPv6 destinations and metadata endpoints; check resolution and each redirect with connection-time protection against DNS rebinding. Limit redirects, body size, content type and time. A URL regex or initial DNS check alone is insufficient. Do not run page scripts or fetch embedded assets. Keep one bounded page and strip navigation/scripts before extracting professional text. Respect site access restrictions and offer paste-text when unavailable.
- Bound each source independently. Proposed caps: 20 repositories, ten papers, one 1 MiB HTML page, one 2 MiB CV, 30,000 extracted CV characters, and five approved CV evidence excerpts. No unbounded pagination or model calls inside item loops. Deduplicate papers by DOI or OpenAlex ID, not title alone.

### CV processing and private data

- Verify actual format and size, not just extension or MIME. For PDFs, cap pages before extraction (proposed 20), disable external resource fetching, and enforce memory/CPU limits. For DOCX, validate the ZIP/container, cap entries and total expanded bytes, reject encrypted/malformed archives, and keep external file access disabled.
- Proposed text parsers: `unpdf` for PDF and `mammoth.extractRawText` for DOCX. Neither is installed today. These dependencies are justified by real document parsing; do not write a PDF/Office parser or render converted HTML. Pin compatible versions during implementation and test them in the deployed Node runtime. Use killable parsing isolation for hard limits; `Promise.race()` alone cannot stop CPU-bound parsing.
- Parse within the authenticated upload operation; discard original bytes after extraction. Persist the bounded extracted input privately in Postgres for synthesis/retry, never in a public blob or a public download URL. Apply ownership checks to every upload/job read and write. No browser-stored CV body or raw-text logging.
- Show that professional CV information can become public through the approved bio/evidence. Exclude phone numbers, email/contact addresses, referees and unrelated sensitive information from model input and public output. Retain only reviewed professional excerpts for matching; the original CV and full extracted input are not searchable evidence.
- Remove temporary CV text when accepted, cancelled, replaced or explicitly removed. Unfinished input expires after 24 hours and cannot be read/used after expiry. Add an authenticated daily cleanup job to physically purge expired input; state its cleanup window honestly, with a proposed target within 48 hours. Verify cron timing on the actual Vercel plan before promising that window. Missing cleanup setup blocks enabling CV in production.
- Expiry also invalidates unaccepted CV-derived drafts/cache entries; require re-upload or removal of that source before approval. Already approved, explicitly selected professional excerpts remain until the user removes their CV source. They are distinct from the full temporary extraction.

### Background work, cost and recovery

- Pilot execution proposal: Postgres job state plus bounded Next.js `after()` work, reusing the existing platform rather than introducing a queue account. Save before scheduling; claim work atomically with a lease so duplicate requests cannot start duplicate synthesis. Give the handler a documented, supported time budget and per-source deadlines.
- `after()` is bounded by the platform's function duration; it is not a durable queue. An interrupted job remains recoverable in Postgres. Status reports a stale lease as stalled, and a deliberate retry POST resumes it. Do not promise automatic completion/retries after a process dies while the user is away. Use a durable queue later if unattended guaranteed retries become required.
- Use one batched synthesis per confirmed source snapshot. Cache by owner, canonical evidence hash, consent/selection generation, model and prompt version. Extend the existing `ai_cache.kind` type for profile synthesis, and make private enrichment cache entries owner-scoped with explicit cleanup; do not place raw CV prompts in the cache key or logs. Cache only validated output and referenced source IDs, with removal on source withdrawal.
- Reuse the installed OpenAI SDK and the existing schema-validation approach in a B2-owned `src/server/profile/enrichment/synthesis.ts`. Leave B1's ask-refinement/explanation implementation unchanged. Limit per-user discovery, upload, start and retry attempts in shared durable storage; do not rely on a per-instance map.
- Expose partial results honestly. One optional provider failure must not deny sign-in or discard successful sources. A draft made with missing sources needs a visible warning before approval. An empty/failed import offers manual editing.

### Import failure messages and help block

The user requested instructions for allowing an import when access is blocked. Show a source-specific expandable **How to fix this** block beside the affected source, based on a sanitized backend reason code. Do not display provider error bodies. Do not claim that a profile is private or blocks access without evidence; a 403 can also mean rate limiting, and missing data can be a valid result.

| Known result | User-facing meaning and action |
| --- | --- |
| Import source off | Not selected / Not imported. Enable that source and its desired subchoices to include it. This is not a failure; keep GitHub sign-in active. |
| Google/GitHub sign-in cancelled | Return to page two with a sanitized code and preserve details; offer both sign-in providers again. Imports may stay off. |
| GitHub connection cancelled or already linked | Keep the current Lanyard session. Offer retry/turn off import, or explain that the GitHub already belongs to another account; never merge or switch accounts silently. |
| Selected source permission off in Lanyard | Show which import choice is disabled and where to enable it. Never broaden requested OAuth scopes automatically. |
| GitHub credential revoked/expired, or confirmed authorization failure | Offer Reconnect GitHub. Explain GitHub Settings > Applications > Authorized OAuth Apps as the place to inspect the app's access. Use the app's actual OAuth registration name, which may still be Convo. Do not tell users to revoke unrelated apps. |
| No public GitHub bio/repos/organisations returned | Say no public information was found for that category. Let users use another source or manual bio. Public organisation membership can be checked using GitHub's documented visibility controls; changing privacy remains optional. Do not call an empty public list a permission failure or request private-repository access. |
| OpenAlex has no confident match | Offer name/workplace correction, ORCID, another candidate or Skip. Do not say the researcher denied access. |
| Selected public page requires login or denies retrieval | Say that this page cannot be imported automatically. Offer another public URL or pasted professional text. Do not bypass a login/access restriction. |
| Provider rate limit, outage or timeout | Say temporarily unavailable, preserve successful selections and show Retry with any supported cooldown. Do not direct the user to change profile privacy. |
| Unreadable/encrypted/scanned CV or invalid format | Explain the specific supported format/size issue and offer a text-based PDF/DOCX or pasted text; keep other sources working. |
| Unknown cause | Import unavailable; offer Retry, another source or manual continuation. Do not guess that profile settings caused it. |

Authentication and import status must remain distinct in the API and UI: signed in can coexist with GitHub import off, empty, failed or requiring reconnect. Only failed identity authentication or failure to save the minimal account can block sign-in. Optional-source permission/import failures cannot.

### Evidence, approval and concurrent changes

- Keep collected inputs, generated drafts and the approved public profile distinct. Evidence has an owner, source kind, stable external ID, source URL where public, retrieval time, consent generation and bounded text. IDs must include owner/source namespaces to avoid collisions.
- Add general durable evidence alongside legacy GitHub storage and backfill existing records without drops or resets. A transitional nullable general snapshot distinguishes not-migrated from intentionally empty; never use an empty-array length test to fall back to withdrawn GitHub evidence.
- `syncProfile()` indexes the complete approved evidence snapshot, preserves revision ordering and clears its pending state only for that exact revision. Update every B2 reader of the old GitHub-only pending flag, including matching exclusions. A rebuild/seed must restore all approved sources and expertise.
- A repeated GitHub sign-in updates only that source's imported snapshot. It must not erase accepted papers, CV excerpts, public-page evidence or the user's edited bio. A newly collected source snapshot becomes a proposed update; do not silently replace an accepted profile while it processes.
- With enrichment enabled, stage newly imported GitHub evidence for review rather than marking an otherwise current accepted profile pending merely because a draft changed. Source withdrawal is the exception: remove its searchable evidence immediately and expose any unconfirmed synchronization honestly.
- Give bio/expertise a separate text-edit revision, in addition to the general search revision. A job records the text revision it started from. Country/availability/colour changes during onboarding are expected and must not make every draft stale. A newer bio/expertise edit makes acceptance return 409 for review/regeneration; never overwrite it with an old draft. Acceptance patches only the chosen fields, increments the general revision and synchronizes the latest full profile.
- Every commit checks the current consent/selection generation. Source removal cancels or invalidates old work and removes that source's evidence, private extracted inputs and cached drafts. Repair the search copy with a newer revision. Do not resurrect removed evidence through a late worker. Flag derived bio claims for user review rather than blindly deleting their hand-written text.
- AI receives external text as untrusted data, without tools or credentials. Output includes a two/three-sentence bio (at most 600 characters), at most eight expertise labels (60 characters each) and supporting evidence IDs. Validate the shape, ownership and references; those checks do not establish truth, so preserve human review. Do not infer expert/maintainer/current-employment claims from a repo language, coauthorship or old affiliation alone.
- Country, workplace and hiring keep their existing display controls. Prevent generated public bio text from automatically reintroducing facts the user hid. Keep private visibility settings, CV contents and unsupported/sensitive claims out of cards and diagnostics.

## 5. Revised shared API (Codex writes; Claude reviews)

The current executable proposal and full handoff are on [b2/profile-enrichment-contract](https://github.com/akv-iu/Convo/blob/b2/profile-enrichment-contract/db/Profile-Enrichment-Contract.md). Its schemas/fake/tests supersede this brief's original combined-discovery route table. Claude's complete requests 1-29 plus the later public-profile-text/nullable-handle clarification have been reconciled.

- GET /api/profile-enrichment: owner state, authentication provider, GitHub connection, onboarded flag, saved identity, latest job and pending CV. Works before onboarding.
- PUT /api/profile-enrichment: stage private identity after authentication, before any source work. Do not publish or require hiring yet.
- POST /api/profile-enrichment/github/connect: protected connection flow; preserve owner, same-site return to page two; refuse an already-linked identity.
- POST /api/profile-enrichment/discover: one source per request, bounded independent author/page previews and owner/input-bound discovery IDs.
- POST /api/profile-enrichment/cv: multipart consent plus file or text, metadata only; one pending CV per owner.
- POST /api/profile-enrichment/cv/:id/remove: idempotent unaccepted-input removal.
- POST /api/profile-enrichment: identity, idempotency key and separate Github/research/page/CV choices. New choices supersede old unaccepted work.
- GET /api/profile-enrichment/:id: state, phase, source snapshots/progress and owner-only evidence-linked draft.
- POST /api/profile-enrichment/:id/retry: same sources, no duplicate valid lease.
- POST /api/profile-enrichment/:id/accept: draft/text versions, approved fields/evidence. 200 after a committed save; structured sync plus saved revision, including not_onboarded.
- POST /api/profile-enrichment/:id/cancel; GET /api/profile-enrichment/sources; POST /api/profile-enrichment/sources/:id/remove.

Same key with changed normalized input (including pasted text) returns 409/idempotency_conflict. No provider errors or private source text in responses/logs. Error codes and retry cooldowns are shared; source off is a status, not failure.

Person.githubLogin is nullable and server-owned; Person.expertise remains optional with no .default through partial updates. CardPerson inherits both. EvidenceDoc URLs are HTTPS and kinds include profile_page/cv; owner/kind/external-ID namespaces never collide with the reserved person:profile document.

Before merging the nullable type, #44 and Claude's a1/nullable-handle compatibility patch must land, or be present in an explicitly approved integration. Codex changes no screen files to hide that dependency.

The operational expired-input cleanup is authenticated, outside the screen contract, and must ship/configure before real CV enablement. Source providers, durable state, parsing isolation and actual OAuth/linking are not implemented by a passing foundation fake.

## 6. Work split: two external sessions, one writer per file

| Work | Codex | Claude |
| --- | --- | --- |
| Existing #44/#45 | Review their latest pushed changes; no competing screen edits | Verify #44's latest fixes and #45's dependent changes with the existing frontend owner, finish remaining findings/regressions, and signal READY FOR PERSON B REVIEW |
| Shared foundation | Sole writer of schemas, route definitions, fake/fixtures/contract tests; proposed config, dependency and deployment files | Review request/response semantics and UI feasibility; do not edit the same shared files |
| Backend | B2: `src/server/profile/`, auth, requests' pending filters, `src/server/real.ts`, `src/app/api/`, `db/`; profile synthesis stays in this B2 service | Consume the agreed endpoints; no B2 edits |
| Frontend | Review behavior/contracts; no competing screen changes | A1/A2 folders and `src/components/ui/`, `tests/e2e/`: page-one details/permissions; page-two Google/GitHub authentication and optional GitHub connection, candidate previews/selection, source toggles, help blocks and CV; badge, availability, progress, review/editor and expertise display |
| Search compatibility | Provide the accepted full Person/evidence snapshot via the existing ingest interface | B1: add expertise to Elastic/in-memory profile matching and synthetic defaults where necessary, and prove seed/rebuild restores all accepted sources. Keep this a separate small B1 PR; coordinate schema assumptions with Codex |

The user has two separate accounts/sessions; do not assume messages or files in one agent's memory are visible to the other. The repository document, agreed contract commit and PR descriptions are the shared record. This brief does not spawn agents or send messages to Claude automatically.

Root/shared files such as `package.json`, `package-lock.json`, `.env.example`, `vercel.json` and `src/server/config.ts` have one writer, Codex, for this feature. Obtain the required owner approval in the shared foundation PR for any ownership exception; do not silently edit an unowned file. Both people approve contract changes. No standing exception to AGENTS.md is created by a branch name.

Keep Person A's other agent from editing these same screen files while the assigned Claude session owns them. A can review. Use separate worktrees for Codex and Claude; never have both switch branches in the same checkout.

## 7. PR and release order

1. **Review this brief and settle nullable-handle compatibility.** #44/#45 are merged; the compatibility patch remains separate. Codex can prepare the contract/fake while Claude coordinates the existing frontend PRs and reviews the proposal. Record any agreed change to this document before either implements against a different shape. Do not run two frontend sessions against the same files.
2. **Foundation PR:** `b2/profile-enrichment-contract`. Prepare the shared schemas/fake/tests, explicit multipart behavior, feature flag/capability handling and agreed dependencies/setup locally. Signal ready and obtain the user's permission to open the PR, as previously requested. Both people approve and the user merges. Keep production behavior unchanged with the new feature disabled.
3. From that exact updated main commit, work in parallel: Codex `b2/profile-enrichment-backend`; Claude `a1/profile-enrichment`. Claude uses the fake immediately. Backend services have recorded-provider tests. No agent edits the other's files to work around an API problem; raise a concrete contract proposal.
4. Claude's separate B1 compatibility PR, `b1/profile-enrichment-search`, uses the agreed types and existing `syncProfile` entry point. Backend and B1 maintain compatibility while the new feature flag is off. Confirm actual dependencies before choosing the merge order; no import may point at a function available only in an unmerged branch.
5. Integrate all three branches in an isolated checkout. Review and test twice, fixing the first round's findings and checking the second for regressions. Retest against the updated main after other merges. The user merges reviewed PRs individually using Create a merge commit. Base feature PRs on main and satisfy all five checks; no gate bypass.
6. Enable the complete feature for a controlled pilot only after all components, migration, provider configuration, cleanup and manual acceptance pass. One product release can consist of several small PRs behind one flag; do not release working-looking controls backed by stubs.

Proposed flag: `PROFILE_ENRICHMENT_ENABLED=0` until release, read only by central config and passed as a server-provided screen capability. An older enabled draft must not bypass a later disabled capability. Keep existing GitHub-only onboarding available while the flag is off. Do not change `FAKE_API`/`FAKES` or other production settings automatically.

## 8. Setup the user performs manually

No keys are needed to agree schemas or build the fake. Before live acceptance:

1. OpenAlex: create an API key and set server-only `OPENALEX_API_KEY` locally and in the intended Vercel environment. Confirm current usage limits in its dashboard.
2. Brave Web Search: create a compatible API key/subscription and set server-only `BRAVE_SEARCH_API_KEY`. Confirm allowed display/retention of search results; use it for candidate discovery and retain only the selected actual source page as evidence.
3. Add a Google OAuth web client (openid profile only, no email/offline scope), with exact localhost and production callback URLs at /api/auth/callback/google. Codex supplies the reviewed setup before live testing. Reuse existing GitHub OAuth, OpenAI, Neon, Elasticsearch and Dash0 settings. No new blob account is proposed because original CV files are discarded after parsing.
4. Generate `CRON_SECRET` privately; configure the authenticated daily expired-input cleanup in `vercel.json`, verify its deployment schedule, and verify the deletion window. Never paste keys or secrets into chat, screenshots or PR bodies.
5. Apply the reviewed additive/backfill migration to the intended Neon database. Existing user data and migrations are preserved; no drop/reset of shared or production tables. Codex supplies the exact command and verification checklist when the migration exists.
6. Redeploy after environment changes. Enable the feature flag only after the live checklist. Existing app fake/real switches remain a separate decision.

## 9. Acceptance tests and handoff signal

All automated tests use local file fixtures, fake APIs, mocked providers/DB and recorded replies. No CI or automated unit test contacts GitHub, OpenAlex, Brave, OpenAI, Neon or Elastic. Run lint, typecheck, unit/contract coverage and Playwright for changed screens, in the required two critical review rounds.

Cover at least:

- Source consent off means no discovery/fetch/model input from that source. Both sign-in providers work with imports off, including Google-only users with no GitHub connection. Errors on enrichment do not lock sign-in out. Page-one drafts survive either provider returning to page two; GitHub import does not start just because authentication finished. CV upload waits until after the redirect/authentication.
- Each of the four source controls is independent on both pages. Turning one off on page two invalidates pending discovery, clears its unaccepted input/selections and prevents final collection. All-off skips model calls. Permission errors, empty public data, rate limits and unknown failures select the right help text, with no invented privacy diagnosis and no unnecessary OAuth scope expansion.
- Name collisions, ORCID mismatch, changed workplace, no candidates, provider failure vs no matches, at most four deduplicated clickable profiles, no automatic selection, and keyboard selection/open-link independence.
- Only confirmed page URLs fetched; malicious URLs, redirects, DNS rebinding, large bodies, wrong content types and injected instructions cannot escape the fetch/model boundary.
- PDF/DOCX text extraction, malformed/oversized/encrypted/scanned input, ZIP expansion limits, parser termination, expiry, replacement, removal and another account's upload/job IDs. Mock parser internals only where needed; retain real small format fixtures.
- Job claim races, duplicate starts, retry/stale leases, refresh/new tab, partial-source failure, empty import, and independent continuation of onboarding. Cancellation/withdrawal while a job runs prevents later publication.
- One batched generation; cache hit/miss; owner-scoped cache/removal; invalid evidence references and unsupported output handled without publishing. No contact/sensitive CV input or credentials in logs, search or public responses.
- Bio edits during import are protected; colour/visibility/availability changes during import are preserved and do not spuriously invalidate approval. Repeated acceptance is safe. Index failure after a DB commit is recoverable with a machine-readable saved version.
- Full evidence and expertise survive another GitHub sign-in, profile/availability saves, Elasticsearch rebuild/reseed and stale updates. Removing a source clears only its evidence. Existing two-account ask/request/booking/resolve journeys still work.
- Mobile labels are actually tappable, including sticky-action layouts; no `dispatchEvent`/force-click substitution for usability checks. Include keyboard and light/dark accessibility checks.

Before live tests, supply ONE complete manual checklist with setup, test identities and their approved source URLs, expected results for all four sources, failure/retry cases, two-account visibility checks, source removal and cleanup. Ask the user before contacting live providers or spending credits. Never claim fakes prove production indexing or live model accuracy.

Every agent ends a deliverable with:

```text
READY FOR REVIEW: <PR URL, branch and commit>
BASE: <main commit and dependency PRs>
CHANGED: <files/behavior and any contract change>
VERIFIED: <first-round findings/fixes; second-round checks and limits>
MANUAL: <one checklist link; live tests done/not done>
OTHER AGENT: <exact dependency or NONE; no implied missing implementation>
MERGE: <ready / blocked, with named approval or gate still needed>
```

Do not merge a PR yourself unless the user explicitly authorizes that merge. Do not invent approvals, silently retarget dependencies or treat a green Gitar check as proof that all review findings are closed.

## 10. Session instructions and PRD amendments

### Claude
Fetch origin/main, origin/b2/profile-enrichment-plan and origin/b2/profile-enrichment-contract. Read this brief, the revised contract handoff, AGENTS.md and the build plan. Google or GitHub authenticates; four optional imports populate Lanyard. No ORCID sign-in. Confirm the nullable, server-owned githubLogin shape, staged private identity, independent discovery, owner-only pasted text, idempotency-conflict behavior and structured synchronization outcome. Return CONTRACT ACK or precise remaining changes.

You own UI/e2e and the separate B1 compatibility PR. Settle #44 and your nullable-handle patch before the foundation's nullable type merges; coordinate other frontend branches before touching overlapping files. B1 work includes shared memory-search state across route modules, expertise matching, the reserved evidence-ID guard and complete-evidence seed/rebuild recovery. Do not edit B2 or shared contract/fake files.

No new onboarding screens until contract ACK and a common merged foundation commit. Flag-on browser configuration/specs require the agreed config writer and owner approval. Ask before live providers; supply one full manual checklist; no PR creation or merge without the user's applicable approval.

### Codex
You own B2 and shared-foundation writing. Keep real endpoints honestly unavailable until implementation. Migration 0005 makes the GitHub handle nullable and adds provider/account-ID ownership with a numeric-ID backfill; do not apply it without user authorization. Real Google/linking must use atomic identity ownership and preserve existing user IDs. Do not infer account ownership from handles, matching emails, names, CVs or selected authors. Keep Google tokens separate from the private GitHub credential path.

Update all approved-evidence persistence/indexing readers in the real backend, preserve edits and use separate text/consent versions. No B1/screen edits as a workaround. Test/review twice; ask before live providers. Keep the feature off and wait for contract approvals and user PR authorization.

### PRD amendments (user decisions recorded 7 November 2026)
- FR-1 and section 8 originally specify GitHub OAuth. Pilot adds Google as an alternative; neither provider grants optional import consent.
- The original future ORCID sign-in item is not part of this release. ORCID remains an optional OpenAlex lookup identifier.
- Research/OpenAlex, CV and one selected public professional page are approved pilot enrichment sources alongside GitHub. The selected bounded public-page fetch extends the original "no scraping" scope; it is not permission for broad crawling, private access or login bypass.
- Connected GitHub can authenticate the same account. Already-owned provider identity is refused; account merging is out of v1.
- Missing GitHub means no handle/link on cards or resolve. No fake handles for Google users.
- Keep the original PRD PDF/DOCX as historical requirements; these explicit amendments and approved contract PR document the change, not a silent rewrite.

## 11. Sources checked for this proposal

- [OpenAlex API and identifier lookup](https://help.openalex.org/api/), [authentication and limits](https://help.openalex.org/api/authentication/), [author matching](https://help.openalex.org/data/authors/disambiguation/), [publication/abstract fields](https://help.openalex.org/data/works/attributes/).
- [Brave Web Search API](https://api-dashboard.search.brave.com/app/documentation/web-search) and [API-key authentication](https://api-dashboard.search.brave.com/documentation/guides/authentication).
- [unpdf extraction and untrusted-file resource limits](https://github.com/unjs/unpdf), [Mammoth text extraction and security](https://github.com/mwilliamson/mammoth.js).
- [Next.js after() and duration limits](https://nextjs.org/docs/app/api-reference/functions/after), [Vercel function limits](https://vercel.com/docs/functions/limitations), [Vercel scheduled execution limits](https://vercel.com/i/event-driven-architecture).
- [OWASP URL-fetching protections](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html) and [external-content prompt injection](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html).
- GitHub's [authorized OAuth applications](https://docs.github.com/en/apps/oauth-apps/using-oauth-apps/reviewing-your-authorized-oauth-apps), [public organisation membership](https://docs.github.com/en/account-and-profile/how-tos/organization-membership/publicizing-or-hiding-organization-membership) and [OAuth organisation restrictions](https://docs.github.com/en/organizations/managing-oauth-access-to-your-organizations-data/about-oauth-app-access-restrictions) inform the cause-specific help; they are not blanket instructions to change a user's privacy settings.

Only documentation and repository inspection were performed for this brief. No real-person discovery, CV upload, provider test, environment change, migration or production setting change has been performed.

# OpenAlex research provider

Status: provider-only implementation on `b/enrichment-research`. The user explicitly deferred configuration and route wiring. No environment template, private settings, contracts, routes, state storage, migrations, screens or B1 code are changed by this phase. The branch depends on the enrichment foundation's types; the eventual PR targets main after its dependencies are integrated.

## Implemented interfaces

`src/server/profile/enrichment/openalex.ts` exports:

- `findResearchAuthors(input, apiKey)`: accepts the existing research discovery body and an explicitly supplied server credential; returns at most four unselected author previews, each with up to three affiliations and three paper samples.
- `collectResearchPapers(owner, authorId, apiKey)`: accepts a confirmed OpenAlex author ID and returns at most ten deduplicated evidence records. The future worker must obtain the author ID from its owner-bound saved selection and verify its lease before calling this function. This function is not an authorization boundary or an active job runner.

Google/GitHub signs the user in. ORCID, name and workplace only help locate candidates; no author is selected automatically and authorship/current employment is not proven. Nothing writes to OpenAlex or ORCID, synthesizes a bio or publishes evidence.

An ORCID lookup takes precedence. Otherwise discovery searches the name, resolves an exact ROR when supplied, and prefers that affiliation. An unmapped ROR or empty affiliation-restricted result falls back once to name search; typed workplace ranks those candidates without asserting current employment. The owner must still confirm the right profile.

Preview papers use one batched works query without abstracts. Collection uses one author-filtered works query, deduplicates by work ID and normalized DOI, and verifies membership in the supplied author. Null/empty titles are skipped without invalidating other papers. Missing, malformed, duplicate-position or incomplete abstract indexes produce title-only evidence. Titles/excerpts are plain text; links use HTTPS DOI pages or public OpenAlex pages. Excerpts are bounded to 3,000 characters.

OpenAlex truncates list responses to 100 authorships. Potentially truncated papers use singleton metadata to confirm authors beyond that prefix: at most four singleton checks for previews and ten for collection. The API cannot supply untruncated authorships through the normal list batch, so these bounded exceptional lookups cannot be replaced by that batch. An unverifiable/excessively large response fails explicitly rather than becoming a false empty collection. A singleton that still reaches its 5,000-author cap without the selected author also fails explicitly.

All requests use the fixed HTTPS OpenAlex API host, reject redirects, bound each body to 1 MiB and share a ten-second deadline per operation. Discovery uses at most eight requests including ROR/fallback/exceptional previews; collection uses at most eleven including exceptional membership checks. No pagination, paper downloads or AI calls occur. The key is passed in the Authorization bearer header, never a URL. Errors discard provider text, URLs, credentials and causes. No provider input/output is logged or persisted by this module.

## Plan and verification

- [x] Write recorded-response tests before the provider; verify missing implementation fails, then implement it.
- [x] Add red-to-green regressions for workplace fallback and keeping credentials out of request URLs.
- [x] Independent review: fix valid null titles and truncated-author membership with failing regressions first. Also reject incomplete abstracts instead of changing their wording by omission.
- [x] Run both full review/test rounds with coverage, lint and typecheck against the compatible integration; report newer-main conflicts separately.
- [x] Prepare the isolated branch for review; PR creation and merging still require the user's approval.

Focused check (no accounts, credentials or external services):

```powershell
npx vitest run src/server/profile/enrichment/openalex.test.ts
```

Recorded fixtures cover ORCID/ROR/name matching, changed workplaces, preview/evidence caps, DOI/ID duplicates, untitled works, large collaborations, unsafe links, missing/malformed abstracts, body limits, timeouts, rate limiting and sanitized failures.

## Deferred configuration and integration

The user chose **provider-only; wire configuration later**. There is no new environment read or `.env.example` entry. A later approved integration will supply OPENALEX_API_KEY privately, reserve the durable discovery rate limit **before** a provider call, bind previews to owner/input/generation, reject stale completions, and connect the authenticated discovery route. Failed attempts must count against the limit. Active research jobs must stay not_ready until the lease-checked collector/synthesis runner can actually execute them.

No live manual test is requested now. At configuration/integration time, provide the complete setup, positive/empty/failure/owner-isolation test and cleanup checklist together, and ask before any real author lookup. This phase does not establish live provider compatibility, a complete import journey or production readiness. Claude's compatibility `8ee0b3a` now incorporates main's avatars; its merge and B2 migration regeneration remain dependencies.

## Verification results

The provider has **31 recorded-response tests**. An independent final review found two real-data cases, both fixed with failing regressions before retesting: legitimate null work titles and truncated author lists. Sparse abstract positions also have a red-to-green regression. No minor findings were deferred by that review.

First full provider-only round: **910 tests in 63 files**, lint/typecheck passing, **98.60% line coverage**, on source `d939b8c` + compatibility `def5d74` + main `ccdffa7`.

Second full round: **915 tests in 64 files**, lint/typecheck passing, **98.61% line coverage**, on source `d939b8c` + compatibility `8ee0b3a` (including current main `d139e82` and #50). For this functional check only, the B2 schema import conflict retained both primaryKey and AvatarId; conflicting migration metadata stayed isolated. No screen conflicts remained. This is not a regenerated/deployable migration chain, and the temporary merge was not published.

## Official references checked on 7 November 2026

- [Bearer authentication and rate hints](https://help.openalex.org/api/authentication/)
- [Author fields, affiliations and filters](https://help.openalex.org/data/authors/)
- [ORCID matching and split profiles](https://help.openalex.org/data/authors/orcid/)
- [Work titles and inverted abstracts](https://help.openalex.org/data/works/attributes/)
- [Authorship limits and singleton responses](https://help.openalex.org/data/authorships/)

Only documentation was browsed. No live provider requests, credentials, CVs or database writes were used.

# Enrichment integration ledger

Plan: integrate the approved foundation, authentication and private state on main `576692d` after #51, preserving the current contract and feature-off behavior. No live migration, provider call, environment change, PR creation or merge is part of this work.

## Boundaries and order

1. Foundation: merge main and regenerate provider identities after main's `0005_new_ask_defaults` and `0006_default_avatars`. Preserve the numeric-ID backfill and all existing migration bytes.
2. Authentication: merge that foundation and regenerate the link-attempt table after its new snapshot.
3. State: merge authentication and regenerate private owner/job state after its new snapshot.
4. Research/GitHub providers: merge the updated state lineage, retaining only their provider changes; do not wire real imports yet.
5. Run local migration checks, prove no generated schema drift, then run lint/typecheck/full tests with coverage in two critical-review rounds. Review the actual branch diffs and publish a precise base for the other sessions.

The source branches remain separate and keep their existing commits; integration uses forward merges rather than rewriting their published history. Claude owns the new public-profile provider and the completed screens; their working trees/files are not edited here. B1 evidence rebuild recovery still needs an agreed approved-evidence store, which the current private job document is not.

## Rulings

- The old competing enrichment migrations have never been applied. Replace their SQL proposals and metadata by regeneration, not renaming. Main's applied/history migrations stay byte-for-byte unchanged.
- Generated DDL does not include the foundation's data backfill. Reattach the reviewed numeric GitHub backfill and compare the full SQL to the earlier reviewed proposal.
- Passing mocked tests and Drizzle's local checks do not prove an upgrade ran on Neon. The user will receive the final application/verification checklist separately; no old provisional migration may be applied.
- This integration changes dependency compatibility and migration history, not the agreed source permissions, routes or frontend flow. Import workers, synthesis and approval are still separate unfinished work.

## Progress

- Foundation: main merged; `0007_provider-identities` regenerated, original DDL/backfill equivalence checked, local Drizzle check passed. Both rounds passed lint/typecheck and 760 tests in 54 files, 98.71% line coverage. Regenerating again reports no schema changes. Existing migration SQL remains unchanged; the regenerated SQL including backfill equals the reviewed proposal.
- Authentication: foundation integrated; `0008_auth-link-attempts` regenerated. Both rounds passed lint/typecheck and 822 tests in 58 files, 98.57% line coverage. Local Drizzle check and no-drift generation passed; table DDL equals the reviewed proposal.
- State: pending integration.
- Providers: pending updated base.

## Acceptance limits

Keep PROFILE_ENRICHMENT_ENABLED disabled in production. This ledger is not final feature sign-off. Live OAuth/imports, PDF/DOCX parsing, approved-evidence persistence/removal, synthesis, operational cleanup and complete two-account acceptance must pass before enablement.

# Regenerated enrichment migrations: manual acceptance

The final chain after main `576692d` is:

| Migration | Effect |
| --- | --- |
| 0007_provider-identities | Nullable GitHub handle, provider ownership table/indexes, numeric GitHub identity backfill. |
| 0008_auth-link-attempts | Private, short-lived GitHub linking attempts; no provider tokens. |
| 0009_enrichment_state | Private staging/job document per owner and cleanup index. |
| 0010_approved_profile_evidence | Nullable approved evidence/expertise, source metadata, general pending flag and text version. No existing-row copy; null retains legacy fallback until atomic approval/withdrawal. |

These were generated against main's 0005 ask defaults and 0006 avatars, not merely renamed. Local checks prove the snapshot chain and generated schema agree; they do not prove the upgrade has run on Neon. The agent has not applied these migrations. Apply 0010 before deploying the approval branch even with the feature flag off; ordinary profile queries select its new columns.

## Setup and application (live; user approval required)

1. Merge the reviewed foundation, authentication and state PRs in order, then use that final checkout. Do not apply competing migrations from old feature branches. Confirm privately that no provisional enrichment 0005/0006/0007 was previously applied. If one was, stop and reconcile the actual database/history before applying this chain.
2. Keep PROFILE_ENRICHMENT_ENABLED=0 in the target deployment. Choose the intended Neon database privately, verify its backup/restore point, and review **all** outstanding migrations; this command also applies missing main migrations. Do not print or paste DATABASE_URL.
3. Check the files locally without connecting:

   ```powershell
   node .\node_modules\drizzle-kit\bin.cjs check
   ```

   Expected: the snapshot check succeeds. Inspect 0007-0010: no tables/rows are dropped; 0007 only relaxes the existing handle constraint and backfills provider identities. 0010 only adds columns. Do not enable enrichment while old deployments can still write legacy evidence.
4. Apply once from the final checkout, using Node 20.6 or later and the correct private environment file:

   ```powershell
   node --env-file="D:\Projects\Convo\.env.local" .\node_modules\drizzle-kit\bin.cjs migrate
   ```

   An existing shell DATABASE_URL overrides the file, so verify that privately first. Expected: successful migration execution, with no errors. Do not retry blindly after an error or alter migration history to bypass it.

## Verify in the intended Neon SQL editor

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('auth_identities', 'auth_link_attempts', 'profile_enrichment_states')
ORDER BY table_name;

SELECT column_name, is_nullable FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'users'
  AND column_name IN ('github_login', 'avatar', 'profile_evidence', 'profile_sources',
                      'profile_evidence_pending', 'expertise', 'text_version');

SELECT u.id FROM users u
LEFT JOIN auth_identities a ON a.provider = 'github'
  AND a.provider_account_id = substring(u.id from 8) AND a.user_id = u.id
WHERE u.id ~ '^github:[1-9][0-9]*$' AND a.user_id IS NULL;

SELECT indexname FROM pg_indexes WHERE schemaname = 'public'
  AND tablename IN ('auth_identities', 'auth_link_attempts', 'profile_enrichment_states')
ORDER BY indexname;

SELECT id, created_at FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 4;
```

Expected: all three new tables; github_login, avatar, profile_evidence and expertise nullable; five 0010 columns present; zero missing numeric identities; primary keys plus auth_identities_user_provider_idx, auth_link_attempts_state_idx and profile_enrichment_states_sweep_idx; four new recorded migration entries if none of 0007-0010 were applied previously. Existing users, asks, requests and chosen avatars remain intact. Do not expose private staging documents, session/state hashes or credentials while verifying.

Re-run the exact migrate command once: expected success with no newly applied entries. Then follow [the authentication checklist](Google-GitHub-Auth.md#complete-manual-acceptance-checklist-live-not-yet-run) and [the private staging checklist](Enrichment-State.md#complete-manual-checklist-future-authorized-live-staging-check) only after their setup and live authorization. Migrations alone do not enable discovery, imports, synthesis or approval.

Cleanup: stop the test server and remove any temporary staging inputs through the owner APIs as described in the staging checklist. Do not delete shared accounts, reset the database or roll back migration history. Production remains disabled until complete feature acceptance.

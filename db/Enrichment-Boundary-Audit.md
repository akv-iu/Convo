# Enrichment security and contract boundary audit

What this change does: the enrichment branches add separate sign-in/import consent, private source collection, background draft generation, explicit approval and source withdrawal. This review follows their trust boundaries; it changes no implementation.

## Reviewed snapshots and limits

- Published backend integration: `3bb5d61` (includes execution `b0c2655`, CV `13d80c9`, discovery API `20c7669`, cleanup `2cd44af`).
- Frontend integration: local committed `5108092`. No origin tracking ref for that integration branch existed when inspected; its component branches are published. This is an in-progress development snapshot, not a released or final-reviewed UI.
- During review, backend advanced locally to `216e994`. Its only diff from `3bb5d61` updates the runner discovery fixture with saved identity and reserved generation. Runtime findings below therefore still apply to that commit. Later runtime/screen fixes require rechecking; no uncommitted changes in another worktree were inspected or edited.
- Scope: cookie/numeric identity ownership, deferred attempt fencing, owner-bound source/job identifiers, CV consent, approval/version/retry semantics, withdrawal/cache erasure, cleanup authentication and public visibility. Pilot usage is assumed; the upload race needs only one owner and two overlapping requests.
- Evidence: static connected-code review and existing checked-in test/handoff evidence. The execution handoff reports two green rounds of 1,149 tests; the discovery handoff reports the now-addressed fixture mismatch. Neither is proof of the combined final build. No lint/build/full suite, browser, live provider, database or account checks were rerun.

## Must fix

### 1. A late CV upload can restore text after newer source choices

Owner: **Claude 1**. Backend `state.ts:97–108`.

The upload counts its attempt, then awaits file reading/worker parsing. Its final mutation does not check the identity/consent generation or whether that upload is still current. While parsing runs, confirm a new start with CV off: job preparation clears pending CV and increments generation. If the page navigates away, the upload can then finish and write its extracted text back into `data.cv`. The frontend's mounted-page cleanup effect cannot repair an upload that finishes after unmount/navigation. In two tabs, a slow older upload can also replace a newer pending CV and cancel work using that newer CV.

Smallest safe fix: reserve an owner-private upload-attempt identity before parsing and fence the final commit against its currentness and the source/consent generation; invalidate reservations on the relevant removal/new-confirmation paths. Use the existing private-state/CAS approach. Client-side cancellation alone is insufficient. On invalidation discard extracted text, preserving newer input/jobs. Add deferred-parser regressions for CV-off confirmation and out-of-order replacements.

If skipped: private CV text can remain staged after the owner has confirmed choices that exclude it, and an obsolete upload can cancel current work. This is owner-private data resurrection, not a demonstrated cross-owner leak.

### 2. Reload/retry throws away the person's edited draft and evidence choices

Owner: **Claude 2**. UI `onboarding/profile/draft-editor.tsx:109–112`; `review-form.tsx:111–116,136–140,195–205`.

Edits live only inside DraftEditor. Retry changes the stage to queued/progress and unmounts that editor. A conflict's “Load the latest” first changes the stage to loading, which also unmounts it. When the draft returns, the editor initializes again from generated bio/expertise and initialPicks; its draft-version key also forces a fresh instance for newer drafts. No parent holds the person's edits. Ordinary polling while editing is safe, but these explicit recovery paths lose work.

Smallest fix: keep edited bio/expertise and picks in the parent across loading/retry, pass them into the replacement draft editor, and reconcile picks with IDs that still exist. Preserve deselections and keep new CV evidence unselected. Test an edited partial draft through retry and an edited draft through a stale/conflict reload.

If skipped: recovery from the backend's correct conflict checks silently discards user input and resets evidence consent choices. This requirement was already discussed; it remains unresolved in the reviewed UI snapshot.

### 3. Manual completion retains private input and can starve expiry cleanup

Owner: **Claude 1**. Backend `state.ts:11,21–36,286–301`; `storage.ts:7–10,25–32`.

This is the known cleanup finding, confirmed still present in the inspected runtime. When all selected sources return empty, finishDraft marks the job manual but retains job.input. expire treats manual as terminal and does not erase it at its input deadline. nextSweepAt still selects that expired input deadline, while mutateOwner returns early when the document is unchanged. Such rows can remain repeatedly due and crowd other owners out of bounded cleanup batches.

Fix manual completion's private-input lifecycle, including matching temporary CV/cache cleanup, and repair stale sweep metadata even when the document is otherwise unchanged. Preserve safe job history and unrelated newer input. Add all-empty/manual expiry and unchanged-stale-deadline regressions. This is already part of Claude 1's assignment, not a newly discovered duplicate task.

If skipped: private-input lifetime exceeds its intended bound and other owners' expiry work can be delayed indefinitely by repeatedly selected rows.

## Boundaries that looked sound in these snapshots

- Cookie linking strips bearer authorization, binds its single-use token to owner/session/state and uses numeric provider subjects. Import capture checks the cookie owner and owner-scoped identity; the GitHub provider independently verifies the token's numeric identity. Tokens remain in encrypted cookie/callback context, not public DTOs/private job JSON.
- Start/retry capture an atomic private dispatch attempt. Retry rotates it; claim checks it alongside lease/state/generation. The existing out-of-order callback regression covers the earlier stale-credential issue. Completed start replays avoid credential capture.
- Discovery reserves a durable attempt before provider access and rejects results from changed owner identity/generation. Selection checks consult the owner's stored candidate list. CV/job/source lookups use owner-scoped state; no client-supplied owner becomes authoritative.
- Approval checks draft/text versions, current consent, evidence ownership/subset and stored collection consistency. Public profile and private staging writes are fenced together. Identical accepted retries repair synchronization without reapplying edited text. Withdrawal removes source evidence, invalidates old jobs and retains unrelated approved sources.
- Cache writes/purges use owner-prefixed keys and private-state guards. Matching excludes pending evidence revisions, then applies country/workplace/hiring visibility. Public profile PATCH omits server-owned GitHub identity/expertise; the service reparses input. Approved evidence may be public by design; this is explained on the review screen and is distinct from raw pending CV text.
- Cleanup authenticates against the configured secret before storage access, fails closed when unset, returns aggregate counts and continues operating with the feature off. The common enrichment adapter preserves auth/origin/size/contract checks and sanitized errors.

These observations are not an absence-of-vulnerabilities guarantee. They do not establish provider behavior, live SQL locking, deployment execution or a physical-deletion SLO.

## Follow-up and verdict

Claude 1: fix/recheck findings 1 and 3 on the final backend checkpoint. Claude 2: fix/recheck finding 2 and publish the exact frontend checkpoint. Use regressions in the implementation branches; this audit branch intentionally contains only this memo. The runner fixture mismatch is fixed by `216e994`; do not weaken generation checks to restore the old fixture. The schedule/retention limitation remains a deployment-readiness item for Codex 1, not evidence that the target is met.

Verdict: **fix 1–3 and recheck the final combined snapshots before sign-off.** Keep the feature disabled. No PR approval, runtime fix, live test, migration or deployment was performed by this audit.

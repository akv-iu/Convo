# Profile enrichment: the five-page flow, integrated

Status: frontend development integration on `b/enrichment-flow-integration`. It is not a PR, and the feature stays off (`PROFILE_ENRICHMENT_ENABLED` unset). Fake-backed browser passes do **not** prove the real backend works; see the live checklist at the end, which has not been run.

## What's in it

- `origin/main` 576692d.
- Pages 3–4 `b/profile-enrichment-preferences` d6ef30a. This already contains the foundation 87ae076 and pages 1–2 `b/profile-enrichment-screens` 8eb3f0a.
- Page 5 `b/profile-enrichment-review` c157619.
- Claude 1's backend checkpoint `b/enrichment-backend-integration` 0151790.

All merges were conflict-free. The checkpoint changes no contract or fake file and no Playwright config. It adds the CV parser dependencies, so run `npm ci` after pulling.

The flow: `/signin` → `/signin/sources` → `/onboarding` (badge) → `/onboarding/free-time` → `/onboarding/profile` (review). With the flag off, every page behaves as on main.

## Screen gaps fixed here

Most of these are on page 5 (`src/app/(onboarding)/onboarding/profile/`).

- **Edits survive a retry, a newer draft and a reload:**
  - Bio, expertise and evidence picks are kept per import in this tab (`sessionStorage`, `convo_enrichment_review`).
  - Edited text wins over a newer draft; unedited text follows the newer draft.
  - Picks survive only for evidence still in the draft. Evidence the person removed stays removed. Evidence new to them starts as usual: ticked, except CV excerpts, which start unticked.
  - A new tab starts from the draft.
  - The kept edits are forgotten on approve or discard (`carryEdits`, `keepEdits`, `readKept`, `saveKept` in `review.ts`).
- **The badge is saved before approval:**
  - With a draft ready but no saved profile (`/api/me` 409), page 5 shows "Save your badge first" and a link to `/onboarding`, with no Approve button.
  - If the server still answers `not_onboarded` at approval (a race), the existing "Finish your badge to publish it" message stays.
- **Hidden-information warnings can't silently go missing:**
  - A profile that fails to load (401, 5xx or offline) now shows the load error, with Try again or "Check my details without it", instead of offering Approve without the owner's hidden-fact warnings.
  - The warnings are only ever shown to the owner on page 5 and never sent anywhere.
- **Pending search sync is a saved result:**
  - It reads "Your bio is approved and saved, but your matches may not show it yet", with no error, and the details page follows.
  - "Update my matches" (the same approval sent again) appears only when the server says `retryable`.
- **The tab forgets the journey at the end:**
  - Finishing the details page, or "Keep my profile" for a returning account on page 2, clears the page-1 draft, page 2's start record and return choices, and page 5's kept edits (`clearOnboardingTab` in `_components/draft.ts`).
  - So a later sign-in in the same tab starts clean.
  - With the flag off only the page-1 draft exists, and the badge already clears it, so nothing visible changes.

Already handled by the merged branches:
- refresh and back navigation on pages 1–4, and imports restarted after a page-1 change (d6ef30a);
- the stale-tab identity check and the CV-off cleanup (8eb3f0a);
- text-changed protection on page 5 (c157619).

## Dependencies and requests

- **Playwright config, needed before any PR:** the committed `playwright.config.ts` runs `tests/e2e/enrichment/**` against the flag-off server, so CI's click-through would fail. The proposed change, still awaiting the user's approval and owned by root config (Claude 1), is:
  - add a second `next start` on port 3001 with `FAKE_API=1 PROFILE_ENRICHMENT_ENABLED=1`;
  - add `enrichment-phone` and `enrichment-laptop` projects (`testMatch: "enrichment/**"`, baseURL 3001);
  - add `testIgnore: "enrichment/**"` on the existing two projects.

  It's tested locally as the untracked `playwright.flag-check.config.ts` (listed in `.git/info/exclude`). It changes a gate, so it needs approval.
- **Backend defects found:** none in what the screens call. The screens use only the contract routes, which the checkpoint leaves unchanged.

## Tests

- **Unit:** `review.test.ts` covers carrying edits, dropped and unseen evidence, CV excerpts staying unticked, seen evidence per import, and blocked or corrupt storage.
- **Browser, flag on** (fake API, a unique `u_google_new_*` owner per test, axe on light and dark). New or changed tests:
  - `review.spec.ts`: edits survive a retry, a newer draft with an excerpt removed, and a reload; the approval body leaves out removed evidence; the tab is cleared at the end. Also: a new tab starts fresh; the badge comes first (with axe); a server `not_onboarded` race; a failed `/api/me` stops approval and recovers with the warnings; pending sync is saved, with or without a retry.
  - `sources.spec.ts`: a returning account keeps its profile and the tab is cleared.

Commands:

```powershell
npx vitest run "src/app/(onboarding)"
$env:CI="1"; npx playwright test -c playwright.flag-check.config.ts tests/e2e/enrichment --workers=2 --retries=0 --reporter=list
```

## Live acceptance checklist (not run; needs your authorization)

**Not run.** It uses real Google and GitHub OAuth, Neon, OpenAlex, Brave and OpenAI (paid), so it needs the user's go-ahead.

**Prerequisites** (Claude 1's backend handoff has the exact commands):
- the backend and this branch are merged into one test deployment or local checkout;
- the reviewed migrations are applied to the test Neon database;
- Google and GitHub OAuth callbacks are set for the test origin;
- `OPENALEX_API_KEY`, `BRAVE_SEARCH_API_KEY`, OpenAI and the cleanup secret are set privately;
- `FAKE_API=0` and `PROFILE_ENRICHMENT_ENABLED=1` on the test environment only. Production stays off.

**Accounts:**
- **A:** a Google account with no Lanyard account and no GitHub linked.
- **B:** a GitHub account with public repositories.

Use two browser profiles, and real but non-sensitive test data. The CV should be a fictional person's PDF.

**Account A, Google, all four sources:**
1. `/signin`: enter name, country, workplace and an ORCID iD. Switch on all four sources (GitHub bio + repos), then Continue. Sign in with Google and land back on `/signin/sources`. Expect your choices kept, "Not connected" for GitHub, and nothing imported yet.
2. Press Connect GitHub and authorize. Expect a return to page 2 connected as @login, still signed in as A.
3. Research: at most 4 authors. Each link opens OpenAlex in a new tab without selecting it. Pick one.
4. Public profile: at most 4 pages. Pick one, or choose "different link" with your own HTTPS page.
5. CV: upload the PDF. Expect the filename with no text shown. Replace it with pasted text, then upload the PDF again.
6. Continue → badge. Choose a colour and avatar, hide your country, set hiring, Continue. Free time: choose times. The import status should move on to "read". Continue.
7. Page 5: check the bio, expertise and evidence. CV excerpts start unticked. Edit the bio and untick one paper.
   - **Retry check:** if a source failed, press "Try them again". Your edits must survive.
   - Reload the page: your edits are still there.
   - Approve. Expect "Your bio is approved" or the pending-sync message, then the details page.
8. Write a bio mentioning your hidden country. Page 5 warns you, and only you. Approve anyway, then confirm the warning text appears nowhere public.
9. `/ask`: as account B (once it's onboarded), search for A's expertise. A appears, with only the ticked evidence and no hidden country.

**Account B, GitHub sign-in, sources off or skipped:**
1. Sign in with GitHub. Expect the handle to come from the server, and no import before Continue.
2. Turn research off. For public profile choose Skip. Paste a small text instead of a CV. Run the badge, free time and page 5 steps. Approve.
3. Start again with all sources off. Expect manual mode: no AI call and no draft, and page 5 is the usual details page.

**Isolation, recovery and withdrawal:**
1. Using A's job ID, upload ID and discovery ID from B's session: every request returns 404, or `selection_stale` / `cv_expired`.
2. As A, open page 5 in a second tab during an import. It catches up, without the first tab's unsaved edits.
3. As A, sign out and sign back in. Page 2 shows "You already have a profile". "Keep my profile" goes to `/ask`.
4. As A, withdraw one source in the source settings. Its evidence leaves search, and old drafts can't be approved.
5. Cancel an unfinished import. It can't publish later.
6. Leave a CV staged for 24 hours, or check what Claude 1's handoff says about cleanup timing. The CV text is gone.

**Cleanup:**
- Withdraw the test sources and delete the test accounts' Lanyard data the way Claude 1's handoff describes.
- Revoke the OAuth grants for the test accounts.
- Turn `PROFILE_ENRICHMENT_ENABLED` off on the test environment.
- Never paste tokens, CV text or provider replies into chat.

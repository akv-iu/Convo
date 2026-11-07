# Profile enrichment foundation: review and frontend handoff

This branch proposes the shared contract and implements its local fake. It does **not** implement provider imports, CV parsing, AI generation, durable jobs or a migration. Real enrichment endpoints return sanitized **501 / `not_ready`**. The new flow is disabled by default; existing sign-in and screens remain unchanged.

Read the [shared delivery brief](https://github.com/akv-iu/Convo/blob/b2/profile-enrichment-plan/db/Profile-Enrichment-Plan.md) first (confirmed journey at `75a0131`), plus `AGENTS.md`, `docs/Build-Plan.md` and `docs/Quality-Gates.md`. This foundation started from main `dde538d`. Both people must approve the proposed contract before merge; Claude should return **CONTRACT ACK** or specific changes before building screens against it. Do not assume #44/#45 have merged: check their current state before choosing the frontend base.

## What is agreed, and what this proposes

The confirmed order is details/four optional source permissions → required GitHub authentication and source confirmation → badge → availability → editable bio approval. GitHub authentication remains required with every import disabled. OAuth returns to the source-confirmation page. Imports start only on its final Continue. Research and public-profile suggestions are separate lists capped at four, with no automatic selection. Link opening and candidate selection are independent.

The executable request/response schemas are in `src/contracts/enrichment.ts` and `src/contracts/routes.ts`; examples are in `src/contracts/fixtures/enrichment.ts`. `src/contracts/fake/contract.test.ts` covers their lifecycle. These files are the proposal to review, rather than an alternative API described only in chat.

Two additions close gaps in the original route table:

- `POST /api/profile-enrichment/cv/:id/remove` discards a staged upload before a job exists. Call this when replacing/removing that upload or disabling CV on page two.
- `GET /api/profile-enrichment/sources` lists approved owner-bound source IDs for returning users. Those IDs are needed to withdraw an accepted source.

The original eight proposed endpoints are also present. No other existing route's request or required response fields change. `Person`/`CardPerson` gain optional `expertise` (absent means an empty list); evidence kinds gain `profile_page` and `cv`. `languages` still means programming languages. Expertise is currently accepted only through enrichment approval; extending ordinary profile writes and their database storage belongs to the backend implementation, not this foundation.

## Frontend integration details

- `config.profileEnrichmentEnabled` is the server-side capability, read only from `PROFILE_ENRICHMENT_ENABLED` in central config. A's server components must pass it to client screens; do not read environment variables from client code. The new screens must remain hidden when false. The server rejects every enrichment endpoint while false, even in fake mode or with a saved old draft.
- To develop the new flow locally, set **both** `FAKE_API=1` and `PROFILE_ENRICHMENT_ENABLED=1`. No provider credentials are needed. Do not enable the feature in Vercel until the real implementation, cleanup and acceptance checks are complete.
- All ten endpoints authenticate and scope IDs to their owner. They must eventually work before onboarding is complete. The foundation fake uses the existing demo identity/profile fixtures; it does not test real incomplete-onboarding storage or OAuth redirects.
- Start sends `identity`, `permissions`, nullable discovery/author/public-profile/upload selections and a client-generated UUID `idempotencyKey`. Keep that key for a retry of the same confirmation. Changed choices need a new key. Candidate selection requires its discovery ID and unchanged discovery identity.
- `permissions.github` has independent `bio`, `repos` and `organisations` booleans. GitHub import off means all three are false; this never turns off authentication. Other controls are `research`, `publicProfile`, `cv`. A source may be enabled but skipped with a null selection. Do not send selected IDs after disabling a source.
- Public-profile selection is null or `{kind: "candidate", candidateId}`, `{kind: "url", url}`, or `{kind: "text", text}`. Manual professional text is a fallback, not a discovered candidate. Public URL shape validation is **not** SSRF protection; the real backend must add the delivery brief's connection-time validation.
- CV uses **multipart/form-data**, not JSON. Send `consent` as the string `"true"`, plus exactly one `file` (PDF/DOCX, ≤2 MiB) or `text` (≤30,000 characters). Let the browser set the boundary: do not manually set Content-Type. One consent field and one payload only. Response: upload ID, filename, extracted-character count, warnings, expiry; no file body or CV text.
- Source controls remain editable before confirmation. Cancel a running unaccepted job before starting changed choices; the fake also invalidates older work on a new confirmation. With all sources off, state is `manual`, no draft, no AI work. Continue manual onboarding.
- Poll `GET /api/profile-enrichment/:id` while `queued`, `collecting` or `synthesizing`. The fake advances once per poll and reaches a recorded draft after three reads. Real progress will not depend on poll count. Stop polling on terminal states/navigation; show `stalled` honestly and use explicit retry.
- `ready` and `partial` expose an owner-only draft and evidence. Show partial-source reasons and “How to fix this” guidance; do not infer privacy settings from empty data or generic errors. Unknown/unavailable differs from no matches.
- Approval sends the draft's `version` and `baseTextRevision`, edited bio/expertise, and chosen evidence IDs. Bio ≤600 characters; ≤8 expertise labels, each ≤60 characters. The backend checks owner, versions, source consent and references. A newer bio edit returns 409. Badge/availability edits do not make the draft stale. Do not publish before approval.
- Approval response has `person` and `sync: {status, retryable, savedRevision}`. `person` can be null when onboarding is unfinished; `not_onboarded` is distinct from search failure. `pending` means Postgres saved but search has not confirmed it: retain the saved result and offer retry, rather than saying nothing saved.
- List approved sources with `enrichmentSources`; withdraw by `sourceId`. `reviewBio: true` means ask the user to review derived claims, not automatically erase their edited bio. Source removal invalidates pending drafts and preserves unrelated accepted evidence. Repeating removal must not cancel newer work.
- Errors are `{error, code}`, with sanitized text. Statuses include 400, 401, 403, 404, 409, 413, 415, 422, 429, 501 and 503; source progress includes its own reason and optional retry cooldown. Never display provider exception bodies. Responses use `Cache-Control: no-store`.

The fake is deliberately recorded data: it does not fetch candidate links, parse file bytes, contact AI or prove identity/source accuracy. File-format inspection, parsing isolation, rate limits, CV retention/cleanup, durable job leases, authentication changes, all-source database persistence and revision-ordered index recovery remain required backend work. Do not advertise these controls as a released working feature because the fake passes.

The fake store now shares one process-local session across separately bundled Next route modules. It remains disposable and is not durable across restarts or multiple server instances. Claude's separate B1 compatibility check must also verify evidence reaches matching through actual route boundaries; module-level unit tests alone do not prove that integration.

**Observed B1 integration dependency:** after the local checklist approved recorded evidence for `u_demo_a`, a new ask from `u_demo_b` for `recorded professional reliable systems` did not return that approved profile. The memory search state is module-local in `src/server/search/memory.ts`; it needs equivalent sharing across route modules as part of Claude's B1 compatibility PR, together with expertise matching. The existing fixture-based match/request/book/resolve flow passed over actual HTTP. The foundation's source APIs are ready for contract review; the complete enrichment-to-matching flow is **not** release-ready until this separate dependency is fixed and retested. Codex did not edit B1's folders.

## Complete local manual checklist

No live providers are contacted. These steps verify the foundation API; screen acceptance comes with Claude's frontend PR.

1. In PowerShell, use this isolated checkout and start the fake with its capability enabled:

   ```powershell
   cd D:\Projects\convo-profile-enrichment-contract
   $savedFakeApi = $env:FAKE_API
   $savedEnrichment = $env:PROFILE_ENRICHMENT_ENABLED
   $env:FAKE_API = "1"
   $env:PROFILE_ENRICHMENT_ENABLED = "1"
   npm run dev -- --port 3130 --webpack
   ```

2. Open `http://localhost:3130` and paste the entire snippet below into DevTools Console. It checks discovery limits, private staging, progress, explicit approval, ownership, source withdrawal, all-off mode and cancellation. Expected last output: **FOUNDATION PASSED**.

   ```js
   async function enrich(path, body, expected = 200, user = "u_demo_a") {
     const form = body instanceof FormData;
     const response = await fetch(`/api/profile-enrichment${path}`, {
       method: body === undefined ? "GET" : "POST",
       headers: { "x-demo-user": user, ...(!form && body !== undefined ? {"Content-Type": "application/json"} : {}) },
       ...(body === undefined ? {} : {body: form ? body : JSON.stringify(body)})
     });
     const data = await response.json();
     if (response.status !== expected) throw new Error(JSON.stringify({path, status: response.status, data}));
     return data;
   }
   function check(value, message) { if (!value) throw new Error(message); }
   var identity = { name: "Demo Researcher", country: "US", workplaceName: "Demo University", rorId: null, orcid: null };
   var discovery = await enrich("/discover", {identity, sources: {research: true, publicProfile: true}});
   check(discovery.research.candidates.length === 4 && discovery.publicProfile.candidates.length === 4, "Candidate limits");
   var form = new FormData(); form.set("consent", "true"); form.set("text", "Recorded professional CV text");
   var cv = await enrich("/cv", form);
   check(!("text" in cv) && !("file" in cv), "Private input leaked");
   var input = { identity, permissions: {github: {bio: true, repos: true, organisations: true}, research: true, publicProfile: true, cv: true},
     discoveryId: discovery.discoveryId, authorId: discovery.research.candidates[0].id,
     publicProfile: {kind: "candidate", candidateId: discovery.publicProfile.candidates[0].id}, cvUploadId: cv.uploadId, idempotencyKey: crypto.randomUUID() };
   var job = await enrich("", input);
   check((await enrich("", input)).jobId === job.jobId, "Duplicate job");
   await enrich(`/${job.jobId}`, undefined, 404, "u_demo_b");
   check((await enrich(`/${job.jobId}`)).state === "collecting", "Collection progress");
   check((await enrich(`/${job.jobId}`)).state === "synthesizing", "Synthesis progress");
   var ready = await enrich(`/${job.jobId}`);
   check(ready.state === "ready" && ready.evidence.length === 4, "Draft missing");
   var approved = await enrich(`/${job.jobId}/accept`, {...ready.draft, bio: "Reviewed foundation demo bio."});
   check(approved.person.bio === "Reviewed foundation demo bio." && approved.sync.status === "synced", "Approval failed");
   var savedSources = await enrich("/sources");
   var cvSource = savedSources.find(s => s.source === "cv");
   await enrich(`/sources/${cvSource.sourceId}/remove`, {});
   check(!(await enrich("/sources")).some(s => s.source === "cv"), "CV source not withdrawn");
   var manual = await enrich("", {...input, permissions: {github: {bio: false, repos: false, organisations: false}, research: false, publicProfile: false, cv: false},
     discoveryId: null, authorId: null, publicProfile: null, cvUploadId: null, idempotencyKey: crypto.randomUUID()});
   check(manual.state === "manual" && manual.draft === null, "All-off triggered generation");
   var cancelled = await enrich(`/${manual.jobId}/cancel`, {});
   check(cancelled.state === "cancelled", "Cancellation failed");
   var pdf = new FormData(); pdf.set("consent", "true"); pdf.set("file", new File(["%PDF-recorded fake"], "demo.pdf", {type: "application/pdf"}));
   var stagedFile = await enrich("/cv", pdf);
   await enrich(`/cv/${stagedFile.uploadId}/remove`, {});
   var wrongType = new FormData(); wrongType.set("consent", "true"); wrongType.set("file", new File(["text"], "demo.txt", {type: "text/plain"}));
   await enrich("/cv", wrongType, 415);
   var tooBig = new FormData(); tooBig.set("consent", "true"); tooBig.set("file", new File([new Uint8Array(2 * 1024 * 1024 + 1)], "large.pdf", {type: "application/pdf"}));
   await enrich("/cv", tooBig, 413);
   var noConsent = new FormData(); noConsent.set("text", "Do not import");
   await enrich("/cv", noConsent, 400);
   console.log("FOUNDATION PASSED");
   ```

3. The script also checks file transport with a tiny synthetic PDF marker, wrong MIME (415), oversize (413) and missing consent (400). This fake does **not** parse PDF/DOCX contents; extraction and its security cases belong to the real backend checklist.

4. Stop the server, set `$env:PROFILE_ENRICHMENT_ENABLED = "0"`, restart with the same command. Calling `/api/profile-enrichment/sources` must return 404 with code `feature_disabled`. Existing pages and `/api/me` must still work in fake mode.

5. Cleanup: stop the dev server (all fake jobs, uploads and edits disappear), then restore the environment values in that PowerShell session:

   ```powershell
   $env:FAKE_API = $savedFakeApi
   $env:PROFILE_ENRICHMENT_ENABLED = $savedEnrichment
   ```

No provider/account setup or database cleanup is needed for this foundation. The complete live acceptance checklist will accompany the real backend; it needs separate permission before any provider calls.

## Verification and review status

- Two critical review/test rounds completed, with extra regression runs after the cross-route store fix. Final lint and typecheck pass; **686 tests pass across 49 files**, with **98.72% overall line coverage**. The new adapter, enrichment schemas and fake lifecycle each have 100% line coverage in the local report. Coverage is not a substitute for the B1 integration dependency above.
- Ran the documented API journey through an actual local Next.js server twice, including the expanded file-transport/error cases on the final run. Verified the disabled flag and unchanged `/api/me`; verified the existing fake match → send → inbox → accept → slots → book → resolve flow with two demo identities over HTTP.
- Review fixes include text-edit staleness during collection, preserving accepted evidence on later profile saves, invalidating old work, repeated-removal safety, sanitized errors, origin checks, bounded multipart parsing and process-shared fake state. A regression test reloads the fake module to catch separate-module state loss.
- No screen files changed, so Playwright was not rerun locally. CI gates and both people's contract approval are still required. No live providers, CV extraction, real OAuth, database migration or production settings were tested or changed. No new dependencies.
- User explicitly approved the edits to central config and `.env.example`. No other root/shared ownership exception is assumed. No PR was opened and nothing was merged; the branch is for review.

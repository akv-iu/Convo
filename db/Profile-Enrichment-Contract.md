# Profile enrichment foundation: revised contract and handoff

Status: proposal for Claude's CONTRACT ACK; not merge-ready. Replaces the GitHub-only foundation at `a4e143f`. This branch still starts from main `dde538d` and requires #44 plus Claude's nullable-handle compatibility commit `ad0c26f` before its typecheck can pass on main. No feature PR has been opened or merged.

Read [the delivery brief](https://github.com/akv-iu/Convo/blob/b2/profile-enrichment-plan/db/Profile-Enrichment-Plan.md), AGENTS.md and the quality gates. The user's 7 November decision supersedes GitHub-only authentication: **Google or GitHub sign-in, no ORCID sign-in**. Research still reads OpenAlex.

## Scope and exact decisions

- Page 1: name, country, typed workplace and optional ORCID; four independent import controls.
- Page 2: Google/GitHub authentication, then optional source connection/confirmation. OAuth returns here with the draft preserved. A Google user who leaves GitHub imports off never needs GitHub. Typed workplace works on page 1; the pilot proposal keeps ROR authenticated and offers directory confirmation on page 2. Do not call the existing directory endpoint while signed out.
- Final Continue snapshots selections and starts import/synthesis; badge and availability follow, then editable bio approval. An all-off confirmation returns terminal `manual` with no draft or AI call.
- Authentication obtains basic identity information; it is inaccurate to say it reads absolutely nothing. Optional GitHub bio/repos/orgs imports start only after final confirmation.
- A connected GitHub can sign into the same Lanyard account. A provider account belongs to at most one Lanyard account. Linking an already-owned GitHub is refused with `github_linked_elsewhere`; no account merging or automatic email linking in this release. Existing user IDs, requests and bookings remain intact.
- `Person.githubLogin` is `string | null`; null means no connected GitHub. Never fabricate a handle. The server owns it and `putMe` strips it, including inside the real update service. `CardPerson` inherits nullability.
- `expertise` remains optional (no default through partial updates), bounded to eight 60-character labels. Ordinary expertise edits/storage belong to the real backend implementation; approval is the foundation's write interface.
- Paper titles/abstracts are normalized as plain text in the real importer; abstracts are optional. Every paper has an HTTPS source URL. Missing abstracts do not fail an import. Limit to ten papers, deduplicated by DOI/OpenAlex ID.
- Generated bio/expertise must omit country, workplace and hiring claims regardless of later visibility selections. Human edits remain editable; the UI warns about hidden facts in edited prose. Sign-in and author selection do not verify authorship.
- Public-profile text fallback is retained: `{kind:"text",text}`, ≤30,000 characters. It is owner-private, never logged, discarded on cancel/supersede/expiry/withdrawal, and returned only as bounded owner-only review excerpts. Its evidence is `source:"public_profile", kind:"profile_page"`, title “Text you pasted”, and **no URL**.

The foundation implements schemas, fake behavior, thin adapters, and the provider-identity schema migration. **Real enrichment endpoints still return sanitized 501/not_ready.** Google OAuth, real account linking, source collection, isolated CV parsing, durable jobs, synthesis, full-evidence persistence/index recovery and private-input cleanup are next backend work. No new dependencies are installed and no production setting is changed.

## Executable contract

The exact shapes are in `src/contracts/enrichment.ts` and `routes.ts`; do not invent a parallel frontend API.

| Name | Method/path | Important behavior |
| --- | --- | --- |
| enrichmentState | GET /api/profile-enrichment | Owner's sign-in provider, GitHub connection/login, onboarded flag, saved page-one identity, latest job and pending CV; works before onboarding. 401 shows sign-in. |
| saveEnrichmentIdentity | PUT /api/profile-enrichment | Privately stage page-one answers after authentication, before discovery/upload, so another tab can resume even before final Continue. Does not publish a profile. |
| connectGitHub | POST /api/profile-enrichment/github/connect | Preserves the current account. Fake returns a recorded connected login; real implementation will return a same-origin /api/auth/ path for the protected connection flow. No client-supplied owner, handle or return URL. |
| discoverEnrichment | POST /api/profile-enrichment/discover | One research/public_profile source per request; ≤4 candidates; independent retries; owner-bound discovery ID and input fingerprint. Human-readable links. |
| uploadCv | POST /api/profile-enrichment/cv | Multipart: consent="true" and exactly one file or text field. PDF/DOCX ≤2 MiB or pasted text ≤30,000 characters. Response contains metadata only; pasted filename is null. |
| removeCv | POST /api/profile-enrichment/cv/:id/remove | Idempotent private staging removal; a new upload replaces the old pending upload. |
| startEnrichment | POST /api/profile-enrichment | Includes identity, UUID idempotencyKey and independently selected sources. New confirmation supersedes unaccepted work. |
| getEnrichment | GET /api/profile-enrichment/:id | State, phase, confirmed-source snapshots/progress and owner-only review draft; no raw pasted input or CV body. |
| retryEnrichment | POST /api/profile-enrichment/:id/retry | Same confirmed sources only. Active lease: 409/running plus retryAfterSeconds. New draft version on recovery. |
| acceptEnrichment | POST /api/profile-enrichment/:id/accept | Expected draft/text versions, edited bio/expertise and selected evidence IDs. Stale reasons are distinct. CV excerpts start unselected in the UI. |
| cancelEnrichment | POST /api/profile-enrichment/:id/cancel | Discards private temporary input; cancelled work cannot publish. |
| enrichmentSources | GET /api/profile-enrichment/sources | Approved source IDs, labels, links where public, evidence counts and approval time. |
| removeEnrichmentSource | POST /api/profile-enrichment/sources/:id/remove | Withdraws one source, invalidates old drafts, preserves unrelated evidence; repeating removal does not cancel newer work. |

Start choices: `github:{import,bio,repos,orgs}`; `research:null | {skip:true} | {discoveryId,candidateId}`; `publicProfile:null | {skip:true} | {discoveryId,candidateId} | {url} | {kind:"text",text}`; `cv:null | {uploadId}`. Null means off; skip means enabled but no selection. Github import with no connection is 409/github_not_connected.

**Idempotency:** same owner + same key + identical normalized body returns the same job. A changed body, including edited pasted text, returns **409/idempotency_conflict**. Use a new key when choices change. Retain only owner-private request fingerprints/metadata for this comparison; do not retain raw pasted text just to compare retries.

Draft includes `draftVersion,baseTextVersion,bio,bioEvidenceIds,expertise:[{label,evidenceIds}],evidence,needsReview`. Evidence has owner/source IDs, kind, title, bounded excerpt, public URL only when appropriate, and retrieval time. IDs follow owner/kind/external-ID namespaces; the reserved `<personId>:profile` is not source evidence.

Approval returns 200 after a committed save, with `person` (nullable before onboarding) and `sync:{status:"confirmed"|"pending"|"not_onboarded",retryable,savedRevision}`. Keep the saved revision when indexing is pending. No saved ID is buried in an error string.

Every failure body is `{error,code,retryAfterSeconds?}`. `EnrichmentReason` is the single source/help-code enum; `EnrichmentErrorCode` adds request/auth/version guards. Source off is a status, not an error reason. The new B2 adapter sanitizes provider messages and logs; the foundation does not silently change every legacy API's error behavior. HTTPS schema validation is not SSRF protection; the real fetcher must still enforce the brief's redirect/DNS/connection/body limits.

## Migration and account identity

`0005_provider-identities.sql`:
- Drops NOT NULL from users.github_login; no existing handles or rows are deleted.
- Adds auth_identities keyed by (provider, provider_account_id), with at most one of each provider per user.
- Backfills GitHub's numeric account ID from existing `github:<number>` user IDs, **not mutable handles**.
- Contains no provider tokens. The real Google/linking backend must use this mapping atomically; the schema alone does not implement OAuth/linking. It must also adopt legacy GitHub rows created after this migration's backfill.

The migration has **not** been applied. Generate/check are local; apply only through the user's reviewed deployment checklist. No reset/drop of shared data.

After the foundation and dependent screens are reviewed, the user can apply to the intended Neon database from this checkout with:

~~~powershell
node --env-file="D:\Projects\Convo\.env.local" .\node_modules\drizzle-kit\bin.cjs migrate
~~~

This runs outstanding migrations too: review them first and confirm the target environment privately. In Neon's SQL editor, verify the following read-only query returns **zero rows** (every existing numeric GitHub identity was backfilled):

~~~sql
SELECT u.id FROM users u
LEFT JOIN auth_identities a ON a.provider = 'github'
  AND a.provider_account_id = substring(u.id from 8) AND a.user_id = u.id
WHERE u.id ~ '^github:[1-9][0-9]*$' AND a.user_id IS NULL;
~~~

Also verify users.github_login is nullable and auth_identities has its composite primary key and unique user/provider index. Do not enable real Google/linking just because the migration exists; callback/linking security still needs implementation and live acceptance.

Google scope proposal: `openid profile`, no email/offline/Drive/Gmail scope. Retain the stable provider subject/account mapping and the user-entered display name; do not persist Google email, profile-picture URLs, raw ID tokens, or access/refresh tokens. Tokens used for validation remain transient. Github access stays in the existing encrypted, private session path and is never assigned a Google token. Auth/linking callback security and exact storage behavior still need real implementation and tests.

## Fixtures and deterministic fake

Existing demo A/B handles remain unchanged.
- `u_demo_researcher`: onboarded, Google-only, githubLogin:null. Documented ask: **qubitcalibration**. Can send a request to u_demo_a.
- `u_demo_google_new`: authenticated Google-only, unfinished onboarding. `/api/me` returns 409, but owner-state/upload/discovery/start work.
- Use `x-demo-user` to select those API identities. Default remains demo A. This is not a simulation of real OAuth redirects.
- Connect GitHub uses the fixed `DEMO_GITHUB_CONNECTION` fixture, never a generated handle. Connecting that same fixture to a different account returns github_linked_elsewhere.
- Polling progresses queued → running/collecting → running/writing → ready/done. No timers or provider calls.
- Identity-name triggers: `[demo:partial]`, `[demo:failed]`, `[demo:stalled]`, `[demo:reconnect]`, `[demo:empty]`. Retry clears recorded temporary failures and creates a new draft version. A staged identity named `[demo:connect_cancelled]` exercises cancelled connection without signing out.
- Discovery-name triggers: `[demo:no_matches]`, `[demo:unavailable]`. Toggling a source off means no discovery request for it.
- CV uses actual file signatures/container markers and bounded bytes, but **does not extract real documents**. PDF marker `%PDF-` passes; `/Encrypt` yields cv_encrypted; `DEMO:UNREADABLE` or `DEMO:SCANNED` yields cv_unreadable. DOCX marker requires ZIP signature plus word/document.xml and [Content_Types].xml. Wrong signatures/MIME are cv_unsupported; oversize is cv_too_large. These checks are recorded fake outcomes, not secure parsing.
- The fake keeps no raw CV/pasted public-profile text. It is process-local and disposable, not durable across restart/instances. B1 must share its own memory-search state across route modules and include expertise/full evidence in matching/rebuild.

## Coordination and gates

1. Review/merge #44 separately, then Claude's `a1/nullable-handle` compatibility patch.
2. Both people review this foundation and Claude returns CONTRACT ACK. Its nullable type intentionally exposes old screen callers until that patch lands. No screen files are changed by Codex.
3. Rebase/retest against the resulting exact main; get user approval before opening the foundation PR. No gate bypass.
4. After the foundation merges, parallel backend and frontend/B1 implementation from the same commit, behind PROFILE_ENRICHMENT_ENABLED=0.
5. Claude owns UI/e2e tests. The flag-on Playwright configuration/specs from request 18 still require the agreed config owner/approval and must land with the frontend; no empty “passing” browser gate is added before screens exist. Existing flag-off browser checks remain required.
6. Account setup, migration, cleanup and live acceptance remain user-controlled. Ask before any live providers or paid tests.

Requests 1–29 are reflected above, with these explicit amendments: retain identity on start/state, retain terminal manual mode, retain public-profile text, retain structured saved-revision sync, and stage nullable-handle rollout behind the compatibility patch. Browser flag-on work is an explicit frontend dependency, not claimed complete.

## Complete local manual checklist (API foundation only)

Run in this worktree with no provider credentials:

~~~powershell
$env:FAKE_API = "1"
$env:PROFILE_ENRICHMENT_ENABLED = "1"
npm run dev -- --port 3130 --webpack
~~~

On http://localhost:3130, paste the whole following snippet into DevTools. It uses recorded demo identities only and changes disposable fake state. Expected final output: REVISED FOUNDATION PASSED.

~~~js
async function enrich(path, body, expected=200, user="u_demo_google_new") {
  const form=body instanceof FormData;
  const response=await fetch(`/api/profile-enrichment${path}`, {
    method:body===undefined?"GET":"POST",
    headers:{"x-demo-user":user,...(body!==undefined&&!form?{"Content-Type":"application/json"}:{})},
    ...(body===undefined?{}:{body:form?body:JSON.stringify(body)})
  });
  const value=await response.json();
  if(response.status!==expected) throw new Error(JSON.stringify({path,status:response.status,value}));
  return value;
}
function check(value,message){if(!value)throw new Error(message);}
var owner=await enrich("");
check(!owner.onboarded && owner.github.login===null,"Google-only identity");
var identity={name:"Demo Researcher",country:"US",workplaceName:"Demo University",rorId:null,orcid:null};
var discovery=await enrich("/discover",{source:"research",name:identity.name,workplaceName:identity.workplaceName,rorId:null,orcid:null});
check(discovery.candidates.length===4,"Research limit");
var form=new FormData();form.set("consent","true");form.set("text","Recorded private CV");
var cv=await enrich("/cv",form);
check(cv.filename===null && !("text" in cv),"CV privacy");
var input={identity,idempotencyKey:crypto.randomUUID(),github:{import:false,bio:false,repos:false,orgs:false},
  research:{discoveryId:discovery.discoveryId,candidateId:discovery.candidates[0].id},
  publicProfile:{kind:"text",text:"Private professional input"},cv:{uploadId:cv.uploadId}};
var job=await enrich("",input);
check((await enrich("",input)).jobId===job.jobId,"Idempotency");
await enrich("",{...input,publicProfile:{kind:"text",text:"Edited input"}},409);
await enrich(`/${job.jobId}`,undefined,404,"u_demo_b");
await enrich(`/${job.jobId}`);await enrich(`/${job.jobId}`);
var ready=await enrich(`/${job.jobId}`);
check(ready.state==="ready" && ready.draft.evidence.length===3,"Ready draft");
var pasted=ready.draft.evidence.find(e=>e.source==="public_profile");
check(pasted.kind==="profile_page" && !("url" in pasted),"Pasted-text source");
var accepted=await enrich(`/${job.jobId}/accept`,{
  draftVersion:ready.draft.draftVersion,baseTextVersion:ready.draft.baseTextVersion,
  bio:"My reviewed professional bio.",expertise:["Reliable systems"],
  evidenceIds:ready.draft.evidence.filter(e=>e.source!=="cv").map(e=>e.id)
});
check(accepted.person===null && accepted.sync.status==="not_onboarded","Pre-onboarding approval");
var sources=await enrich("/sources");
await enrich(`/sources/${sources.find(s=>s.source==="public_profile").id}/remove`,{});
var manual=await enrich("",{...input,idempotencyKey:crypto.randomUUID(),research:null,publicProfile:null,cv:null});
check(manual.state==="manual" && manual.draft===null,"All-off manual flow");
await enrich(`/${manual.jobId}/cancel`,{});
var linked=await enrich("/github/connect",{});
check(linked.status==="connected","Recorded GitHub connection");
check((await enrich("")).signIn.provider==="google","Linking changed sign-in owner");
console.log("REVISED FOUNDATION PASSED");
~~~

Then stop the server, set PROFILE_ENRICHMENT_ENABLED=0 and restart. GET /api/profile-enrichment must return 404/feature_disabled; existing /api/me for demo A still returns 200. Cleanup: stop the server and restore your previous shell environment values (or close this task's terminal); all fake data disappears. Do not modify .env.local or Vercel for this checklist.

Real OAuth, real extraction, indexing/rebuild, cleanup/retention and the complete browser journey require the later integration checklist. A passing fake does not establish any of them.

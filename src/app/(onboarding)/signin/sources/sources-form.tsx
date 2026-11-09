"use client";

/**
 * Profile enrichment's page two: sign in with Google or GitHub, then confirm
 * each source chosen on page one. Each discovery runs on its own and never
 * chooses for you. Continue sends the contract's start request, and the
 * badge page follows while the import runs.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SourceUrl } from "@/contracts/enrichment";
import type { RouteResponse } from "@/contracts/routes";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { clearOnboardingTab, ENRICHMENT_TAB_KEYS, readDraft, saveDraft } from "../../_components/draft";
import {
  DEFAULT_SOURCES,
  identityFrom,
  keyFor,
  sameIdentity,
  startBody,
  startProblems,
  type Identity,
  type Picks,
  type ProfileChoice,
  type SourceChoices,
  type StartKey,
  type StartProblem,
} from "../../_components/enrichment";
import type { Reason } from "../../_components/reasons";
import { consentSources } from "../../consent";
import { enrichmentApi } from "./api";
import { ProfileSource, ResearchSource, reasonOf, type Found, type ProfileMode } from "./candidates";
import { CvSource, type CvUpload } from "./cv-source";
import { HowToFix } from "./how-to-fix";

type Owner = RouteResponse<"enrichmentState">;
type Discovery = RouteResponse<"discoverEnrichment">;
type Load =
  | { state: "loading" }
  | { state: "signed-out" }
  | { state: "no-details"; onboarded: boolean }
  | { state: "failed" }
  | { state: "ready"; owner: Owner; identity: Identity };

/** Where final Continue goes: the badge, while the import runs. */
const NEXT_PAGE = "/onboarding";

/** consent.ts names GitHub's bio "profile"; the start request calls it "bio". */
const githubKey = { profile: "bio", repos: "repos", orgs: "orgs" } as const;

/** The control to focus for each problem that stops Continue. */
const problemTarget: Record<StartProblem, string> = {
  github_categories: "#github-categories input",
  github_connect: "#github-connect",
  profile_url: "#profile-url",
  profile_text: "#profile-text",
  cv_missing: "#cv-file",
};

const h1Class = "text-[2.6rem] font-extrabold leading-[1.02] tracking-[-0.03em] [font-stretch:85%] sm:text-6xl";
const hintClass = "px-1 text-sm text-muted";
const errorClass = "text-sm font-medium text-[var(--danger)]";

/**
 * The signed-in owner and page one's identity. A page-one draft from this tab
 * wins once and is saved privately, so another tab can resume before
 * Continue. After that the saved identity is used, so this tab can't later
 * write its older copy over one saved from another tab. Sources come from the
 * draft; without them, CV starts on only if a CV is already staged.
 */
async function loadOwner(): Promise<{ load: Load; sources: SourceChoices }> {
  const draft = readDraft();
  const load = await ownerLoad(draft && !draft.identitySaved ? identityFrom(draft) : null);
  const latest = readDraft(); // switches may have changed while this loaded
  if (latest && !latest.identitySaved && load.state === "ready") saveDraft({ ...latest, identitySaved: true });
  const staged = load.state === "ready" && load.owner.pendingCv !== null;
  return { load, sources: latest?.sources ?? { ...DEFAULT_SOURCES, cv: staged } };
}

const unavailable = (status: number): Load => ({ state: status === 401 ? "signed-out" : "failed" });

async function ownerLoad(fromDraft: Identity | null): Promise<Load> {
  const state = await enrichmentApi.state();
  if (!state.ok) return unavailable(state.status);
  const identity = fromDraft ?? state.data.identity;
  // An account that finished onboarding before enrichment has no saved details here, yet can keep its profile.
  if (!identity) return { state: "no-details", onboarded: state.data.onboarded };
  if (!fromDraft || sameIdentity(fromDraft, state.data.identity)) return { state: "ready", owner: state.data, identity };
  const saved = await enrichmentApi.saveIdentity(fromDraft);
  return saved.ok ? { state: "ready", owner: saved.data, identity } : unavailable(saved.status);
}

/** Jobs that are still working or waiting for review; going back to the badge keeps them. */
const ACTIVE_JOB = new Set(["queued", "running", "stalled", "ready", "partial"]);

/** A ?reason= that no longer applies: sign-in worked, or GitHub has since connected. */
function resolved(reason: Reason, owner: Owner): boolean {
  if (reason === "sign_in_cancelled") return true;
  return owner.github.connected && (reason === "github_connect_cancelled" || reason === "github_linked_elsewhere");
}

/**
 * Page two's choices, kept in this tab while Connect GitHub goes to GitHub and
 * back, so returning (connected, cancelled or refused) discards nothing. The
 * discoveries are kept too: a fresh search would give new candidate IDs.
 * Read once on return and deleted; a changed identity or an expired search
 * isn't restored.
 */
const RETURN_KEY = ENRICHMENT_TAB_KEYS.ret;

interface Kept {
  identity: Identity;
  research: Found<Discovery>;
  pages: Found<Discovery>;
  author: string | null;
  profileMode: ProfileMode;
  profileUrl: string;
  profileText: string;
}

function keepForReturn(kept: Kept) {
  try {
    sessionStorage.setItem(RETURN_KEY, JSON.stringify(kept));
  } catch {
    // Storage off: the choices are made again after returning.
  }
}

function takeKept(identity: Identity): Kept | null {
  try {
    const raw = sessionStorage.getItem(RETURN_KEY);
    sessionStorage.removeItem(RETURN_KEY);
    const kept = raw ? (JSON.parse(raw) as Kept) : null;
    return kept && sameIdentity(kept.identity, identity) ? kept : null;
  } catch {
    return null;
  }
}

/** A kept search that's still usable, or null to search again. */
function stillValid(found: Found<Discovery> | undefined): Found<Discovery> {
  return found?.state === "done" && Date.parse(found.value.expiresAt) > Date.now() ? found : null;
}

/** The start request without this visit's picks: what the page shows on loading, before anything is chosen. */
const unpickedRequest = (identity: Identity, sources: SourceChoices, cvUploadId: string | null) =>
  JSON.stringify(startBody(identity, sources, { research: null, publicProfile: null, cvUploadId }));

/**
 * The import this tab started and the (unpicked) request it was started with. Coming back with that
 * import still active and nothing changed, here or on page one, carries on with it; anything else starts again.
 */
const STARTED_KEY = ENRICHMENT_TAB_KEYS.started;
const startRecord = (jobId: string, request: string) => JSON.stringify({ jobId, request });

function rememberStart(record: string) {
  try {
    sessionStorage.setItem(STARTED_KEY, record);
  } catch {
    // Storage off: coming back starts again, which is safe.
  }
}

function startedHere(record: string): boolean {
  try {
    return sessionStorage.getItem(STARTED_KEY) === record;
  } catch {
    return false;
  }
}

function githubStatus(github: Owner["github"]): string {
  if (!github.connected) return "Not connected to this account.";
  return github.login ? `Connected as @${github.login}.` : "Connected.";
}

export function SourcesForm({
  reason,
  signInWithGoogle,
  signInWithGitHub,
}: {
  reason: Reason | null;
  signInWithGoogle: () => Promise<void>;
  signInWithGitHub: () => Promise<void>;
}) {
  const router = useRouter();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [sources, setSources] = useState<SourceChoices>(DEFAULT_SOURCES);
  const [research, setResearch] = useState<Found<Discovery>>(null);
  const [pages, setPages] = useState<Found<Discovery>>(null);
  const [author, setAuthor] = useState<string | null>(null);
  const [profileMode, setProfileMode] = useState<ProfileMode>(null);
  const [profileUrl, setProfileUrl] = useState("");
  const [profileText, setProfileText] = useState("");
  const [cvUpload, setCvUpload] = useState<CvUpload | null>(null);
  const [cvRemoveFailed, setCvRemoveFailed] = useState(false);
  const [cvProblem, setCvProblem] = useState<Reason | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [githubFailure, setGithubFailure] = useState<Reason | null>(null);
  const [tried, setTried] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startFailure, setStartFailure] = useState<{ reason: Reason; retryAfterSeconds: number | null } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const key = useRef<StartKey | null>(null);
  const searches = useRef({ research: 0, public_profile: 0 });
  /** The start request as this page loaded, before any change: Continue with exactly that keeps a running import. */
  const asLoaded = useRef<string | null>(null);

  const discover = useCallback(async (source: "research" | "public_profile", identity: Identity) => {
    const set = source === "research" ? setResearch : setPages;
    const run = ++searches.current[source];
    set({ state: "loading" });
    const { name, workplaceName, rorId, orcid } = identity;
    const result = await enrichmentApi.discover({ source, name, workplaceName, rorId, orcid });
    if (run !== searches.current[source]) return; // a newer search replaced this one
    set(result.ok ? { state: "done", value: result.data } : { state: "failed", failure: result });
    // A pick survives a new search only if the new results still offer it (Back re-runs discovery on this kept page).
    const offered = (id: string) => result.ok && result.data.candidates.some((c) => c.id === id);
    if (source === "research") setAuthor((a) => (a && a !== "none" && !offered(a) ? null : a));
    else setProfileMode((m) => (m && typeof m === "object" && !offered(m.candidateId) ? null : m));
  }, []);

  const apply = useCallback(
    ({ load: next, sources: chosen }: { load: Load; sources: SourceChoices }) => {
      setSources(chosen);
      setLoad(next);
      if (next.state !== "ready") return;
      setCvUpload(next.owner.pendingCv);
      asLoaded.current = unpickedRequest(next.identity, chosen, next.owner.pendingCv?.uploadId ?? null);
      const kept = takeKept(next.identity);
      const keptResearch = stillValid(kept?.research);
      const keptPages = stillValid(kept?.pages);
      if (kept) {
        setAuthor(keptResearch ? kept.author : null);
        setProfileMode(kept.profileMode && typeof kept.profileMode === "object" && !keptPages ? null : kept.profileMode);
        setProfileUrl(kept.profileUrl);
        setProfileText(kept.profileText);
      }
      if (keptResearch) setResearch(keptResearch);
      else if (chosen.research) void discover("research", next.identity);
      if (keptPages) setPages(keptPages);
      else if (chosen.publicProfile) void discover("public_profile", next.identity);
    },
    [discover],
  );

  useEffect(() => {
    let live = true;
    void loadOwner().then((result) => {
      if (live) apply(result);
    });
    return () => {
      live = false;
    };
  }, [apply]);

  function reload() {
    setLoad({ state: "loading" });
    void loadOwner().then(apply);
  }

  /** Source switches stay editable; this tab's page-one draft remembers them. */
  function changeSources(next: SourceChoices) {
    setSources(next);
    const draft = readDraft();
    if (draft) saveDraft({ ...draft, sources: next });
  }

  function toggleResearch(on: boolean) {
    changeSources({ ...sources, research: on });
    if (on && load.state === "ready" && (!research || research.state === "failed")) void discover("research", load.identity);
  }

  function toggleProfile(on: boolean) {
    changeSources({ ...sources, publicProfile: on });
    if (on && load.state === "ready" && (!pages || pages.state === "failed")) void discover("public_profile", load.identity);
  }

  /**
   * Discards a staged CV. If that fails while turning CV off, CV goes back on
   * (and only CV: switches changed meanwhile stay), so nothing is silently kept.
   */
  const removeCv = useCallback(
    (upload: CvUpload, turningOff: boolean) =>
      enrichmentApi.removeCv(upload.uploadId).then((result) => {
        const removed = result.ok || result.status === 404;
        setCvRemoveFailed(!removed);
        if (removed) return setCvUpload((u) => (u?.uploadId === upload.uploadId ? null : u));
        setCvUpload((u) => u ?? upload);
        if (!turningOff) return;
        setSources((s) => ({ ...s, cv: true }));
        const draft = readDraft();
        if (draft?.sources) saveDraft({ ...draft, sources: { ...draft.sources, cv: true } });
      }),
    [],
  );

  // CV is off but a CV is staged: turned off here, turned off on page one, or the upload finished after turning it off.
  const stagedWhileOff = !sources.cv && cvUpload ? cvUpload : null;
  useEffect(() => {
    if (stagedWhileOff) void removeCv(stagedWhileOff, true);
  }, [stagedWhileOff, removeCv]);

  function toggleCv(on: boolean) {
    changeSources({ ...sources, cv: on });
    setCvProblem(null);
  }

  async function connectGitHub() {
    if (connecting) return;
    setConnecting(true);
    setGithubFailure(null);
    const result = await enrichmentApi.connectGitHub();
    if (!result.ok) {
      setConnecting(false);
      setGithubFailure(reasonOf(result));
      return;
    }
    const connected = result.data;
    if (connected.status === "redirect") {
      // The real flow continues at GitHub and comes back to this page with the choices kept.
      if (load.state === "ready") keepForReturn({ identity: load.identity, research, pages, author, profileMode, profileUrl, profileText });
      window.location.assign(connected.path);
      return;
    }
    setConnecting(false);
    const login = connected.login;
    setLoad((l) => (l.state === "ready" ? { ...l, owner: { ...l.owner, github: { connected: true, login } } } : l));
  }

  if (load.state === "loading") {
    return (
      <div className="mx-auto max-w-xl">
        {reason && <HowToFix reason={reason} />}
        <p role="status" className="mt-4 text-lg text-muted">
          Loading…
        </p>
      </div>
    );
  }

  if (load.state === "signed-out") {
    return (
      <section className="mx-auto flex max-w-xl flex-col gap-4" aria-labelledby="signin-heading">
        <h1 id="signin-heading" className={h1Class}>
          Sign in
        </h1>
        {reason && <HowToFix reason={reason} />}
        <p className="text-lg text-muted">
          Signing in only creates or opens your Lanyard account. Use whichever account you
          have. Nothing is imported until you choose your sources and press Continue.
        </p>
        {/* Two equal choices: neither account is required, so neither button looks like the default. */}
        <form action={signInWithGoogle}>
          <Button type="submit" variant="secondary" className="w-full text-lg">
            Continue with Google
          </Button>
        </form>
        <form action={signInWithGitHub}>
          <Button type="submit" variant="secondary" className="w-full text-lg">
            Continue with GitHub
          </Button>
        </form>
        <p className="text-sm text-muted">
          With Google, Lanyard keeps your Google account ID, not your email or photo. With GitHub, it keeps your account ID and
          username.
        </p>
      </section>
    );
  }

  if (load.state === "no-details" && load.onboarded) {
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-4">
        <h1 className={h1Class}>You already have a profile</h1>
        <p className="text-lg text-muted">
          Keep it as it is, or add your details to suggest a new bio from your sources. Nothing changes until you approve it.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button href="/ask" onClick={clearOnboardingTab}>
            Keep my profile
          </Button>
          <Button href="/signin" variant="secondary">
            Add your details
          </Button>
        </div>
      </div>
    );
  }

  if (load.state === "no-details") {
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-4">
        <h1 className={h1Class}>Start with your details</h1>
        <p className="text-lg text-muted">Lanyard needs your name, workplace and country before it can look for your work.</p>
        <Button href="/signin" className="self-start">
          Add your details
        </Button>
      </div>
    );
  }

  if (load.state === "failed") {
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-4">
        <p role="alert" className="text-lg">
          This page couldn&apos;t load. Check your connection and try again.
        </p>
        <Button onClick={reload} className="self-start">
          Try again
        </Button>
      </div>
    );
  }

  const { owner, identity } = load;
  const gh = sources.github;
  const done = (found: Found<Discovery>) => (found?.state === "done" ? found.value.discoveryId : null);
  const researchId = done(research);
  const pagesId = done(pages);

  function profileChoice(): ProfileChoice {
    if (profileMode === "url") return { kind: "url", url: profileUrl.trim() };
    if (profileMode === "text") return { kind: "text", text: profileText };
    if (profileMode && typeof profileMode === "object" && pagesId) return { kind: "candidate", discoveryId: pagesId, candidateId: profileMode.candidateId };
    return null;
  }

  const picks: Picks = {
    research: author && author !== "none" && researchId ? { discoveryId: researchId, candidateId: author } : null,
    publicProfile: profileChoice(),
    cvUploadId: cvUpload?.uploadId ?? null,
  };
  const problems = startProblems(sources, picks, {
    github: { connected: owner.github.connected },
    profileUrlValid: SourceUrl.safeParse(profileUrl.trim()).success,
  });
  const shown = (p: StartProblem) => tried && problems.includes(p);
  const profileProblem = (["profile_url", "profile_text"] as const).find(shown) ?? null;

  async function onContinue() {
    if (starting) return;
    setTried(true);
    if (problems.length) {
      document.querySelector<HTMLElement>(problemTarget[problems[0]])?.focus();
      return;
    }
    const body = startBody(identity, sources, picks);
    // Back here from a later page and nothing changed: carry on with the running import instead of starting another.
    // Only when this tab started that import with these same choices: a change on page one doesn't show here.
    const active = owner.job && ACTIVE_JOB.has(owner.job.state) ? owner.job.jobId : null;
    const loaded = asLoaded.current;
    if (active && loaded === JSON.stringify(body) && startedHere(startRecord(active, loaded))) return router.push(NEXT_PAGE);
    key.current = keyFor(body, key.current);
    setStarting(true);
    setStartFailure(null);
    setNotice(null);
    const result = await enrichmentApi.start({ ...body, idempotencyKey: key.current.key });
    // Reset on success too: Next keeps this page mounted while hidden, and Back shows it again as it was.
    // A second tap during navigation reuses the same idempotency key, so it can't start another import.
    setStarting(false);
    if (result.ok) {
      rememberStart(startRecord(result.data.jobId, unpickedRequest(identity, sources, cvUpload?.uploadId ?? null)));
      router.push(NEXT_PAGE);
      return;
    }
    if (result.status === 401) return setLoad({ state: "signed-out" });
    if (result.code === "selection_stale" || result.code === "github_not_connected") {
      // Details changed in another tab, a suggestion expired, or GitHub was disconnected: reload and look again.
      setAuthor(null);
      setProfileMode((m) => (m && typeof m === "object" ? null : m));
      setNotice("Something changed since this page loaded, so it was refreshed. Check your choices and press Continue again.");
      return void loadOwner().then(apply);
    }
    if (result.code === "cv_expired") {
      setCvUpload(null);
      setCvProblem("cv_expired");
      return;
    }
    setStartFailure({ reason: reasonOf(result), retryAfterSeconds: result.retryAfterSeconds });
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col">
      <h1 className={h1Class}>Choose what Lanyard reads</h1>
      <p className="mt-3 text-lg text-muted">
        Signed in with {owner.signIn.provider === "google" ? "Google" : "GitHub"}. Lanyard reads only the sources you leave on,
        after you press Continue.
      </p>

      <div className="mt-6 flex flex-col gap-4">
        {reason && !resolved(reason, owner) && <HowToFix reason={reason} />}
        {owner.job && ACTIVE_JOB.has(owner.job.state) && (
          <div className="flex flex-col gap-2 rounded-xl border-2 border-border bg-surface px-4 py-3">
            <p className="font-semibold">Your sources are already being read</p>
            <p className="text-sm text-muted">
              Carry on with your badge, or change your sources below and press Continue to start again.
            </p>
            <Button href={NEXT_PAGE} variant="secondary" className="self-start">
              Continue to your badge
            </Button>
          </div>
        )}
        {notice && (
          <p role="status" className="rounded-xl border-2 border-border bg-surface px-4 py-3 text-sm">
            {notice}
          </p>
        )}
        {owner.onboarded && (
          <div className="flex flex-col gap-2 rounded-xl border-2 border-border bg-surface px-4 py-3">
            <p className="font-semibold">You already have a profile</p>
            <p className="text-sm text-muted">
              Keep it as it is, or choose sources below to suggest a new bio. Nothing changes until you approve it.
            </p>
            <Button href="/ask" onClick={clearOnboardingTab} variant="secondary" className="self-start">
              Keep my profile
            </Button>
          </div>
        )}
      </div>

      <div className="mt-8 flex flex-col gap-9">
        <section aria-label="GitHub" className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Switch label="GitHub" checked={gh.on} describedBy="github-hint" onChange={(on) => changeSources({ ...sources, github: { ...gh, on } })} />
            <p id="github-hint" className={hintClass}>
              {githubStatus(owner.github)} Turning this off never signs you out.
            </p>
          </div>
          {gh.on && (
            <>
              <fieldset id="github-categories" className="ml-4 flex flex-col gap-1 border-0 border-l-2 border-l-border py-1 pl-4">
                <legend className="sr-only">What Lanyard may read from GitHub</legend>
                {consentSources.map((c) => (
                  <label
                    key={c.id}
                    className="grid min-h-12 cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 rounded-lg px-1 py-1 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent"
                  >
                    <input
                      type="checkbox"
                      checked={gh[githubKey[c.id]]}
                      aria-describedby={`github-${c.id}-hint`}
                      onChange={(e) => changeSources({ ...sources, github: { ...gh, [githubKey[c.id]]: e.target.checked } })}
                      className="col-start-1 row-span-2 row-start-1 size-5 shrink-0 accent-accent focus-visible:outline-none"
                    />
                    <span className="col-start-2 row-start-1 font-semibold">{c.label}</span>
                    <span id={`github-${c.id}-hint`} className="col-start-2 row-start-2 text-sm text-muted">
                      {c.hint}
                    </span>
                  </label>
                ))}
              </fieldset>
              {shown("github_categories") && <p className={errorClass}>Choose at least one, or turn off GitHub.</p>}
              {!owner.github.connected && (
                <div className="flex flex-col gap-2">
                  <p className="text-sm">
                    Connect GitHub to import from it. You stay signed in to this account; Lanyard never merges accounts.
                  </p>
                  <Button id="github-connect" variant="secondary" className="self-start" aria-disabled={connecting} onClick={connectGitHub}>
                    {connecting ? "Connecting…" : "Connect GitHub"}
                  </Button>
                  {shown("github_connect") && <p className={errorClass}>Connect GitHub, or turn off GitHub.</p>}
                </div>
              )}
              {githubFailure && <HowToFix reason={githubFailure} />}
            </>
          )}
        </section>

        <ResearchSource
          on={sources.research}
          onToggle={toggleResearch}
          found={research}
          onRetry={() => void discover("research", identity)}
          picked={author}
          onPick={setAuthor}
        />

        <ProfileSource
          on={sources.publicProfile}
          onToggle={toggleProfile}
          found={pages}
          onRetry={() => void discover("public_profile", identity)}
          mode={profileMode}
          onMode={setProfileMode}
          url={profileUrl}
          onUrl={setProfileUrl}
          text={profileText}
          onText={setProfileText}
          problem={profileProblem}
        />

        <CvSource
          on={sources.cv}
          onToggle={toggleCv}
          upload={cvUpload}
          onUploaded={(upload) => {
            setCvUpload(upload);
            setCvProblem(null);
          }}
          onRemove={() => cvUpload && void removeCv(cvUpload, false)}
          removeFailed={cvRemoveFailed}
          problem={cvProblem ?? (shown("cv_missing") ? "cv_missing" : null)}
        />
      </div>

      <div className="mt-8 flex flex-col gap-3">
        <p className="text-sm text-muted">
          Lanyard reads your chosen sources while you make your badge. Nothing is shown to others until you approve your bio.
        </p>
        {startFailure && <HowToFix reason={startFailure.reason} retryAfterSeconds={startFailure.retryAfterSeconds} />}
      </div>
      {/* Only the button is sticky on phones, so a message never grows to cover the page. The page's
          scroll padding keeps a focused field or link above it. */}
      <div className="sticky bottom-0 -mx-4 mt-3 bg-background/95 px-4 pb-4 pt-3 backdrop-blur max-sm:[html:has(&)]:scroll-pb-24 sm:static sm:mx-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
        <Button type="button" className="w-full text-lg sm:w-auto sm:px-10" aria-disabled={starting} onClick={onContinue}>
          {starting ? "Starting…" : "Continue"}
        </Button>
      </div>
    </div>
  );
}

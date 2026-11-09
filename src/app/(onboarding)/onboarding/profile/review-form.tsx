"use client";

/**
 * Page five with profile enrichment on. Reads the import job (GET /api/profile-enrichment,
 * then /:id every two seconds while it runs), shows the draft for review, and after
 * Approve or "Write my own bio instead" continues with the usual details page.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { EnrichmentJob } from "@/contracts/enrichment";
import type { Person } from "@/contracts/types";
import { enrichmentApi } from "../../signin/sources/api";
import { DiscardChoice } from "./discard-choice";
import { DraftEditor, type Accepted } from "./draft-editor";
import { loadProblem } from "./edits";
import { ProfileForm } from "./profile-form";
import { acceptProblem, reviewView, saveKept } from "./review";
import { ReviewProgress } from "./review-progress";

const POLL_MS = 2000;

type Stage =
  | { kind: "loading" }
  | { kind: "failed"; status: number }
  | { kind: "job"; job: EnrichmentJob }
  | { kind: "details"; notice: "approved" | Accepted | null }
  | { kind: "unfinished" };

const statusClass = "max-w-xl rounded-xl border-2 border-border bg-surface px-4 py-3";

/** The saved profile; "no-badge" before the badge page has saved one (409); otherwise the failed status (0: offline). */
async function loadPerson(): Promise<Person | "no-badge" | number> {
  try {
    const response = await fetch("/api/me", { cache: "no-store" });
    if (response.status === 409) return "no-badge";
    return response.ok ? ((await response.json()) as Person) : response.status;
  } catch {
    return 0;
  }
}
const headingClass = "text-[2.6rem] font-extrabold leading-[1.02] tracking-[-0.03em] [font-stretch:85%] sm:text-6xl";

/** After approval: approved, or saved but search hasn't caught up (the identical approval repairs it). */
function SavedNotice({ notice, jobId, onApproved }: { notice: "approved" | Accepted; jobId: string; onApproved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (notice === "approved") {
    return (
      <p role="status" className={`mb-8 ${statusClass}`}>
        Your bio is approved.
      </p>
    );
  }
  async function retry(body: Accepted["body"]) {
    setBusy(true);
    setProblem(null);
    const result = await enrichmentApi.accept(jobId, body);
    setBusy(false);
    if (!result.ok) return setProblem(acceptProblem(result).message);
    if (result.data.sync.status === "confirmed") return onApproved();
    setProblem("Your matches still aren't updated. Try again in a moment.");
  }
  // Saved either way; a retry only helps when the server says it can.
  return (
    <div className={`mb-8 flex flex-col gap-3 ${statusClass}`}>
      <p role="status">Your bio is approved and saved, but your matches may not show it yet.</p>
      {problem && <p role="alert" className="font-medium text-[var(--danger)]">{problem}</p>}
      {notice.retryable && (
        <Button variant="secondary" onClick={() => retry(notice.body)} disabled={busy} className="self-start">
          {busy ? "Updating…" : "Update my matches"}
        </Button>
      )}
    </div>
  );
}

export function ReviewForm() {
  const [stage, setStage] = useState<Stage>({ kind: "loading" });
  const [person, setPerson] = useState<Person | null>(null);
  const [badgeSaved, setBadgeSaved] = useState(true);
  const [jobId, setJobId] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState<"retry" | "discard" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  // Load the job and the profile: the badge must be saved before approval, and its hidden facts drive the warnings.
  useEffect(() => {
    let live = true;
    void (async () => {
      const [state, me] = await Promise.all([enrichmentApi.state(), loadPerson()]);
      if (!live) return;
      setPerson(typeof me === "object" ? me : null);
      setBadgeSaved(me !== "no-badge");
      if (!state.ok) return setStage({ kind: "failed", status: state.status });
      // Without the profile, the owner's hidden-fact warnings would silently go missing, so say so instead.
      if (typeof me === "number") return setStage({ kind: "failed", status: me });
      if (!state.data.job) return setStage({ kind: "details", notice: null });
      const job = await enrichmentApi.job(state.data.job.jobId);
      if (!live) return;
      if (!job.ok) return setStage({ kind: "failed", status: job.status });
      setJobId(job.data.jobId);
      setStage({ kind: "job", job: job.data });
    })();
    return () => {
      live = false;
    };
  }, [attempt]);

  // While the import runs, read it again every two seconds.
  const running = stage.kind === "job" && reviewView(stage.job) === "working" ? stage.job.jobId : null;
  useEffect(() => {
    if (!running) return;
    let live = true;
    const timer = setTimeout(async () => {
      const job = await enrichmentApi.job(running);
      if (!live) return;
      // A failed read keeps the last progress on screen; the new object schedules the next poll.
      setStage((current) => (job.ok ? { kind: "job", job: job.data } : { ...current }));
    }, POLL_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [running, stage]);

  async function retry(id: string) {
    setBusy("retry");
    setProblem(null);
    const result = await enrichmentApi.retry(id);
    setBusy(null);
    if (result.ok) return setStage({ kind: "job", job: result.data });
    // Already retried (another tab): load the running import so this page follows it, keeping kept edits.
    if (result.code === "running") return (setStage({ kind: "loading" }), setAttempt((n) => n + 1));
    setProblem("Lanyard couldn't start again. Try again in a moment.");
  }

  async function discard(id: string) {
    setBusy("discard");
    setProblem(null);
    const result = await enrichmentApi.cancel(id);
    setBusy(null);
    if (result.ok || result.code === "not_found") {
      saveKept(null); // the draft is gone, and so are edits to it
      return setStage({ kind: "details", notice: null });
    }
    setProblem("The draft wasn't discarded. Try again in a moment.");
  }

  function accepted(result: Accepted) {
    if (result.sync === "not_onboarded") return setStage({ kind: "unfinished" });
    setStage({ kind: "details", notice: result.sync === "confirmed" ? "approved" : result });
  }

  if (stage.kind === "loading") {
    return (
      <p role="status" aria-busy="true" className="text-lg text-muted">
        Loading your bio…
      </p>
    );
  }

  if (stage.kind === "failed") {
    const failure = loadProblem(stage.status);
    return (
      <div className="flex max-w-md flex-col gap-6">
        <h1 className={headingClass}>Your bio</h1>
        <p role="alert" className="text-lg">{failure.message}</p>
        {failure.action ? (
          <Button href={failure.action.href} className="self-start">{failure.action.label}</Button>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button onClick={() => (setStage({ kind: "loading" }), setAttempt((n) => n + 1))}>Try again</Button>
            {/* An import outage must not block onboarding: the usual details page works without it. */}
            <Button variant="secondary" onClick={() => setStage({ kind: "details", notice: null })}>
              Check my details without it
            </Button>
          </div>
        )}
      </div>
    );
  }

  if (stage.kind === "unfinished") {
    return (
      <div className="flex max-w-xl flex-col gap-6">
        <h1 className={headingClass}>Your bio</h1>
        <p role="status" className={statusClass}>Your bio is saved. Finish your badge to publish it.</p>
        <Button href="/onboarding" className="self-start">Go to your badge</Button>
      </div>
    );
  }

  if (stage.kind === "details") {
    return (
      <>
        {stage.notice && jobId && (
          <SavedNotice notice={stage.notice} jobId={jobId} onApproved={() => setStage({ kind: "details", notice: "approved" })} />
        )}
        <ProfileForm />
      </>
    );
  }

  const job = stage.job;
  const discardChoice: ReactNode = (
    <>
      {problem && <p role="alert" className="font-medium text-[var(--danger)]">{problem}</p>}
      <DiscardChoice onDiscard={() => discard(job.jobId)} busy={busy === "discard"} />
    </>
  );
  const view = reviewView(job);
  if (view === "none" || view === "done") return <ProfileForm />;
  if (view === "review" && job.draft && !badgeSaved) {
    // Approval publishes onto the saved card, so the badge comes first; the draft waits here.
    return (
      <div className="flex max-w-xl flex-col gap-6">
        <h1 className={headingClass}>Your bio</h1>
        <p role="status" className={statusClass}>Your bio is ready to check. Save your badge first, then come back here to approve it.</p>
        <Button href="/onboarding" className="self-start">Go to your badge</Button>
      </div>
    );
  }
  if (view === "review" && job.draft) {
    return (
      <DraftEditor
        key={`${job.jobId}:${job.draft.draftVersion}`}
        job={{ ...job, draft: job.draft }}
        person={person}
        discard={discardChoice}
        onKeep={() => discard(job.jobId)}
        onAccepted={accepted}
        onReload={() => (setStage({ kind: "loading" }), setAttempt((n) => n + 1))}
        onRetry={() => retry(job.jobId)}
        retrying={busy === "retry"}
      />
    );
  }
  return (
    <ReviewProgress
      job={job}
      working={view === "working"}
      retrying={busy === "retry"}
      onRetry={() => retry(job.jobId)}
      discard={discardChoice}
    />
  );
}

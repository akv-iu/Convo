"use client";

/**
 * Profile enrichment's import, as one line on the availability page: it runs
 * while the person picks free times, never blocks Continue, and says plainly
 * when it stopped. Reads again only while the import is working; Try again
 * restarts the same sources. Page five shows the details.
 */
import { useEffect, useState } from "react";
import type { EnrichmentJob } from "@/contracts/enrichment";
import { Button } from "@/components/ui/button";
import { enrichmentApi } from "../../signin/sources/api";

const POLL_MS = 3000;
type Job = Pick<EnrichmentJob, "jobId" | "state">;

const WORKING = new Set<Job["state"]>(["queued", "running"]);

/** What to say for each state; states with nothing to say (no import, manual, finished elsewhere) show nothing. */
const MESSAGES: Partial<Record<Job["state"], string>> = {
  queued: "Lanyard is reading your sources. Carry on: your bio will be ready to check after this step.",
  running: "Lanyard is reading your sources. Carry on: your bio will be ready to check after this step.",
  ready: "Your sources have been read. You'll check your bio next.",
  partial: "Some of your sources couldn't be read. You'll check what was found next, and can try the rest again there.",
  stalled: "Reading your sources has stalled.",
  failed: "Your sources couldn't be read.",
};

export function ImportStatus() {
  const [job, setJob] = useState<Job | null>(null);
  const [round, setRound] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // Find the latest import, then read it again every few seconds while it's working.
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function read(jobId: string | null) {
      const id = jobId ?? (await enrichmentApi.state().then((s) => (s.ok ? (s.data.job?.jobId ?? null) : null)));
      if (!id || !live) return;
      const current = await enrichmentApi.job(id);
      if (!live || !current.ok) return; // a failed read keeps what's on screen
      setJob({ jobId: current.data.jobId, state: current.data.state });
      if (WORKING.has(current.data.state)) timer = setTimeout(() => void read(id), POLL_MS);
    }
    void read(null);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [round]);

  async function retry(jobId: string) {
    setRetrying(true);
    setProblem(null);
    const result = await enrichmentApi.retry(jobId);
    setRetrying(false);
    if (result.ok || result.code === "running") return setRound((n) => n + 1);
    setProblem("Lanyard couldn't start again. Try again in a moment, or carry on and check your bio later.");
  }

  const message = job && MESSAGES[job.state];
  if (!job || !message) return null;
  const stopped = job.state === "stalled" || job.state === "failed";
  return (
    <div className="mt-6 flex max-w-xl flex-col gap-2 rounded-xl border-2 border-border bg-surface px-4 py-3">
      <p role="status" className="text-sm">
        {message}
      </p>
      {stopped && (
        <Button variant="secondary" className="self-start" disabled={retrying} onClick={() => retry(job.jobId)}>
          {retrying ? "Starting again…" : "Try again"}
        </Button>
      )}
      {problem && (
        <p role="alert" className="text-sm font-medium text-[var(--danger)]">
          {problem}
        </p>
      )}
    </div>
  );
}

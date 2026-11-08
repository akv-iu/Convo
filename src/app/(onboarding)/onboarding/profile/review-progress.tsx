"use client";

/**
 * Page five while the import runs, or when it stopped: each chosen source and
 * how far it got, help for any that failed, and Try again.
 */
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { EnrichmentJob } from "@/contracts/enrichment";
import { HowToFix } from "../../signin/sources/how-to-fix";

type Source = EnrichmentJob["sources"][number];

export const SOURCE_NAME: Record<Source["source"], string> = {
  github: "GitHub",
  research: "Research papers",
  public_profile: "Public profile",
  cv: "CV",
};

const STATUS: Record<Source["status"], string> = {
  not_selected: "Not chosen",
  waiting: "Waiting",
  running: "Reading",
  done: "Done",
  empty: "Nothing found",
  failed: "Didn't work",
  removed: "Removed",
};

const headingClass = "text-[2.6rem] font-extrabold leading-[1.02] tracking-[-0.03em] [font-stretch:85%] sm:text-6xl";

export function SourceFailures({ sources }: { sources: Source[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {sources.filter((s) => s.status === "failed").map((s) => (
        <li key={s.sourceId} className="flex flex-col gap-1">
          <p className="font-semibold">{SOURCE_NAME[s.source]}</p>
          <HowToFix reason={s.reason ?? "unknown"} retryAfterSeconds={s.retryAfterSeconds} />
        </li>
      ))}
    </ul>
  );
}

export function ReviewProgress({
  job,
  working,
  retrying,
  onRetry,
  discard,
}: {
  job: EnrichmentJob;
  working: boolean;
  retrying: boolean;
  onRetry: () => void;
  discard: ReactNode;
}) {
  const chosen = job.sources.filter((s) => s.status !== "not_selected");
  const stopped = job.state === "stalled" ? "Reading your sources stopped before it finished." : "Reading your sources didn't work.";
  return (
    <div className="flex max-w-xl flex-col gap-6">
      <h1 className={headingClass}>{working ? "Writing your bio" : "Your bio"}</h1>
      {working ? (
        <p role="status" className="text-lg text-muted">
          Reading your sources. This usually takes a minute; you can wait here.
        </p>
      ) : (
        <p className="text-lg">{stopped} Nothing has been added to your profile.</p>
      )}
      <ul aria-label="Your sources" className="flex flex-col gap-2">
        {chosen.map((s) => (
          <li key={s.sourceId} className="flex justify-between gap-4 rounded-xl border-2 border-border bg-surface px-4 py-3">
            <span className="font-semibold">{SOURCE_NAME[s.source]}</span>
            <span className="text-muted">{STATUS[s.status]}</span>
          </li>
        ))}
      </ul>
      {!working && <SourceFailures sources={chosen} />}
      {!working && (
        <Button onClick={onRetry} disabled={retrying} className="self-start">
          {retrying ? "Starting again…" : "Try again"}
        </Button>
      )}
      {discard}
    </div>
  );
}

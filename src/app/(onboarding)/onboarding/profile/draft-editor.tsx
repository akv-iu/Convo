"use client";

/**
 * Page five's review: the bio and expertise Lanyard drafted, every piece of
 * evidence behind them (CV excerpts start unticked), and Approve. Nothing is
 * published until Approve succeeds; a person who edited their bio since the
 * draft was written keeps their words (the server would refuse the draft anyway).
 */
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { EnrichmentJob } from "@/contracts/enrichment";
import type { Person } from "@/contracts/types";
import { enrichmentApi } from "../../signin/sources/api";
import { ChipEditor } from "./chip-editor";
import { addPending } from "./edits";
import {
  acceptBody, acceptProblem, BIO_MAX, claimsWithoutEvidence, evidenceTitle, EXPERTISE, hiddenFacts, initialPicks,
  type AcceptAction, type ReviewEdits,
} from "./review";
import { SOURCE_NAME, SourceFailures } from "./review-progress";

type Draft = NonNullable<EnrichmentJob["draft"]>;
export type Accepted = { sync: "confirmed" | "pending" | "not_onboarded"; body: ReturnType<typeof acceptBody> };

const headingClass = "text-[2.6rem] font-extrabold leading-[1.02] tracking-[-0.03em] [font-stretch:85%] sm:text-6xl";
const labelClass = "text-xl font-bold leading-snug tracking-tight";
const noteClass = "rounded-xl border-2 border-[var(--danger-border)] bg-surface px-4 py-3 text-sm";
const EXCERPT = 280;

function Warnings({ draft, edits, person }: { draft: Draft; edits: ReviewEdits; person: Person | null }) {
  const hidden = person ? hiddenFacts(`${edits.bio} ${edits.expertise.join(" ")}`, person) : [];
  const unsupported = claimsWithoutEvidence(draft, edits.picks, edits.expertise);
  if (!hidden.length && !unsupported.bio && !unsupported.expertise.length) return null;
  return (
    <div aria-live="polite" className="flex flex-col gap-2">
      {hidden.length > 0 && (
        <p className={noteClass}>
          Your bio mentions {hidden.join(", ")}, which you&apos;ve hidden from your card. You can still approve it, or edit
          it to keep that private.
        </p>
      )}
      {unsupported.bio && <p className={noteClass}>Some of what your bio says came from evidence you removed. Check it&apos;s still right.</p>}
      {unsupported.expertise.length > 0 && (
        <p className={noteClass}>No evidence is left for {unsupported.expertise.join(", ")}. Check it&apos;s still right.</p>
      )}
    </div>
  );
}

function EvidenceList({ draft, picks, onPicks }: { draft: Draft; picks: string[]; onPicks: (picks: string[]) => void }) {
  return (
    <fieldset className="flex flex-col gap-3 border-0 p-0" aria-describedby="review-evidence-hint">
      <legend className={`mb-1 ${labelClass}`}>Evidence</legend>
      <p id="review-evidence-hint" className="-mt-1 text-sm text-muted">
        Ticked items can appear on your profile and to people you match with. CV excerpts start unticked.
      </p>
      <ul className="flex flex-col gap-3">
        {draft.evidence.map((e, i) => {
          const id = `review-evidence-${i}`;
          const excerpt = e.excerpt.length > EXCERPT ? `${e.excerpt.slice(0, EXCERPT - 1)}…` : e.excerpt;
          return (
            <li key={e.id} className="flex gap-3 rounded-xl border-2 border-border bg-surface px-4 py-3">
              <input
                id={id}
                type="checkbox"
                checked={picks.includes(e.id)}
                onChange={(ev) => onPicks(ev.target.checked ? [...picks, e.id] : picks.filter((p) => p !== e.id))}
                className="mt-1 size-5 shrink-0 accent-[var(--accent)]"
              />
              <div className="flex min-w-0 flex-col gap-1">
                <label htmlFor={id} className="font-semibold break-words">
                  {evidenceTitle(e)}
                </label>
                <p className="text-sm text-muted">{SOURCE_NAME[e.source]}</p>
                <p className="text-sm break-words">{excerpt}</p>
                {e.url && (
                  <a href={e.url} target="_blank" rel="noopener noreferrer" className="self-start text-sm font-medium text-accent underline underline-offset-4">
                    Open the source<span className="sr-only"> for {evidenceTitle(e)} (new tab)</span>
                  </a>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

export function DraftEditor({
  job,
  person,
  discard,
  onKeep,
  onAccepted,
  onReload,
  onRetry,
  retrying,
}: {
  job: EnrichmentJob & { draft: Draft };
  person: Person | null;
  discard: ReactNode;
  onKeep: () => void;
  onAccepted: (accepted: Accepted) => void;
  onReload: () => void;
  onRetry: () => void;
  retrying: boolean;
}) {
  const draft = job.draft;
  const [edits, setEdits] = useState<ReviewEdits>(() => ({
    bio: draft.bio, expertise: draft.expertise.map((e) => e.label), picks: initialPicks(draft),
  }));
  const [chip, setChip] = useState({ text: "", problem: null as string | null });
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<{ message: string; action: AcceptAction } | null>(null);
  const update = (patch: Partial<ReviewEdits>) => setEdits((current) => ({ ...current, ...patch }));
  const failed = job.sources.some((s) => s.status === "failed");

  async function approve(e: { preventDefault(): void }) {
    e.preventDefault();
    if (saving) return;
    setProblem(null);
    const added = addPending(edits.expertise, chip.text, EXPERTISE); // what's typed in Add counts, as on step 4
    if (added.problem) {
      setChip({ ...chip, problem: added.problem });
      document.getElementById("review-expertise")?.focus();
      return;
    }
    const next = { ...edits, expertise: added.list };
    setEdits(next);
    setChip({ text: "", problem: null });
    const body = acceptBody(draft, next);
    setSaving(true);
    const result = await enrichmentApi.accept(job.jobId, body);
    setSaving(false);
    if (!result.ok) return setProblem(acceptProblem(result));
    onAccepted({ sync: result.data.sync.status, body });
  }

  const problemAction: Record<AcceptAction, ReactNode> = {
    reload: <Button variant="secondary" onClick={onReload}>Load the latest</Button>,
    signin: <Button variant="secondary" href="/signin">Sign in again</Button>,
    retry: null, // Approve again
    keep: <Button variant="secondary" onClick={onKeep}>Keep my bio</Button>,
  };

  return (
    <form onSubmit={approve} noValidate className="flex max-w-xl flex-col gap-8">
      <div>
        <h1 className={headingClass}>Check your bio</h1>
        <p className="mt-3 text-lg text-muted">
          Lanyard wrote this from the sources you chose. Nobody sees it until you approve it, and you can change anything.
        </p>
      </div>

      {draft.needsReview && (
        <div className={`${noteClass} flex flex-col gap-3`}>
          <p>You changed your bio after this draft was written, so Lanyard won&apos;t replace your words with it.</p>
          <Button variant="secondary" onClick={onKeep} className="self-start">
            Keep my bio
          </Button>
        </div>
      )}

      {failed && (
        <div className="flex flex-col gap-3">
          <p className="font-semibold">Some sources didn&apos;t work. You can approve what was found, or try them again.</p>
          <SourceFailures sources={job.sources} />
          <Button variant="secondary" onClick={onRetry} disabled={retrying} className="self-start">
            {retrying ? "Starting again…" : "Try them again"}
          </Button>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <label htmlFor="review-bio" className={labelClass}>
          Bio
        </label>
        <textarea
          id="review-bio"
          rows={4}
          value={edits.bio}
          maxLength={BIO_MAX}
          aria-describedby="review-bio-count"
          onChange={(e) => update({ bio: e.target.value })}
          className="w-full rounded-xl border-2 border-border bg-surface px-4 py-3 text-lg leading-snug focus-visible:border-accent focus-visible:outline-none"
        />
        <p id="review-bio-count" className="self-end text-sm text-muted">
          {edits.bio.length} of {BIO_MAX}
        </p>
      </div>

      <ChipEditor
        id="review-expertise"
        legend="Expertise"
        hint={`Topics people can ask you about. Up to ${EXPERTISE.chips}.`}
        values={edits.expertise}
        onChange={(expertise) => update({ expertise })}
        text={chip.text}
        onTextChange={(text) => setChip((c) => ({ ...c, text }))}
        problem={chip.problem}
        onProblemChange={(p) => setChip((c) => ({ ...c, problem: p }))}
        placeholder="e.g. Qubit calibration"
        addLabel="Add expertise"
        empty="No expertise yet. Add what people can ask you about."
        limits={EXPERTISE}
      />

      <EvidenceList draft={draft} picks={edits.picks} onPicks={(picks) => update({ picks })} />

      <Warnings draft={draft} edits={edits} person={person} />

      {discard}

      {/* Above the sticky button, so a message never grows the bar over the form on a phone. */}
      {problem && (
        <div role="alert" className="flex flex-col gap-2">
          <p className="font-medium text-[var(--danger)]">{problem.message}</p>
          {problemAction[problem.action]}
        </div>
      )}

      {!draft.needsReview && (
        <div className="sticky bottom-0 -mx-4 bg-background/95 px-4 pb-4 pt-3 backdrop-blur sm:static sm:mx-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
          <Button type="submit" disabled={saving} className="w-full text-lg sm:w-auto sm:px-8">
            {saving ? "Saving…" : "Approve and continue"}
          </Button>
        </div>
      )}
    </form>
  );
}

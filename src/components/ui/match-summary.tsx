/**
 * The condensed row for a person in someone's matches: their colour, name,
 * handle, the facts they chose to show, and why Lanyard picked them. Used
 * by the match list (A2) and by step 4's "how people see you" preview (A1).
 */
import type { CSSProperties } from "react";
import type { MatchResult } from "@/contracts/types";
import { personColour } from "./badge-colours";
import { badgeFacts } from "./person-badge";

/** The condensed row: colour, name, handle, the facts they show, and why Lanyard picked them. */
export function MatchSummary({
  match,
  sent = false,
  passed = false,
}: {
  match: Pick<MatchResult, "person" | "explanation" | "mutual">;
  sent?: boolean;
  /** Passed on in this visit while "Keep people I pass on hidden" is off, so they stay listed. */
  passed?: boolean;
}) {
  const p = match.person;
  const facts = badgeFacts(p);
  return (
    <span style={{ "--badge": personColour(p) } as CSSProperties} className="flex min-w-0 flex-1 items-start gap-3 text-left">
      <span aria-hidden="true" className="mt-0.5 size-10 shrink-0 rounded-full bg-[var(--badge)]" />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-lg font-bold leading-snug break-words">{p.name}</span>
          <span className="text-sm text-muted">@{p.githubLogin}</span>
        </span>
        {facts.length > 0 && <span className="block text-sm text-muted">{facts.join(" · ")}</span>}
        <span className="mt-1 block line-clamp-2 text-sm leading-snug">{match.explanation}</span>
        {(sent || passed || match.mutual || p.synthetic) && (
          <span className="mt-1.5 flex flex-wrap gap-1.5">
            {sent && <span className="rounded-full bg-accent px-2.5 py-0.5 text-xs font-bold text-on-accent">Request sent</span>}
            {passed && !sent && <span className="rounded-full bg-[var(--skeleton)] px-2.5 py-0.5 text-xs font-bold">Passed</span>}
            {match.mutual && (
              <span className="rounded-full bg-accent/20 px-2.5 py-0.5 text-xs font-semibold">Looking for someone like you too</span>
            )}
            {p.synthetic && (
              <span className="rounded-full border border-dashed border-border px-2.5 py-0.5 text-xs font-semibold">
                Synthetic profile<span className="sr-only">: a made-up demo attendee</span>
              </span>
            )}
          </span>
        )}
      </span>
    </span>
  );
}

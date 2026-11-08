/**
 * A match in the list (A2): a condensed row anyone can scan, and the full
 * profile it opens into. Hidden profile fields simply aren't there, and a
 * hidden hiring answer is never shown as "not hiring" (badgeFacts).
 */
import type { CSSProperties } from "react";
import type { EvidenceDoc, MatchResult } from "@/contracts/types";
import { personColour } from "@/components/ui/badge-colours";
import { badgeFacts, githubProfile } from "@/components/ui/person-badge";
export { MatchSummary } from "@/components/ui/match-summary";
import { highlightParts } from "./matches";

/** What each kind of evidence is called on the open profile. */
export const evidenceKindLabel: Record<EvidenceDoc["kind"], string> = {
  repo: "Repository",
  commit_area: "Code area",
  paper: "Paper",
  talk: "Talk",
  abstract: "Abstract",
};

/** The full profile a row opens into: their badge, why them, the evidence, and what they work with. */
export function MatchDetails({ match, nameId }: { match: MatchResult; nameId: string }) {
  const p = match.person;
  return (
    <div style={{ "--badge": personColour(p) } as CSSProperties} className="flex flex-col gap-4">
      <div className="flex gap-3 rounded-xl border-l-8 border-[var(--badge)] bg-background px-3 py-2.5">
        <span aria-hidden="true" className="mt-1 size-12 shrink-0 rounded-full bg-[var(--badge)]" />
        <div className="min-w-0 flex-1">
          <h2 id={nameId} className="text-2xl font-bold leading-snug tracking-tight break-words">
            {p.name}
          </h2>
          {p.githubLogin && (
            <a
              href={githubProfile(p.githubLogin)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-accent underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-accent"
            >
              @{p.githubLogin} on GitHub<span className="sr-only"> (opens in a new tab)</span>
            </a>
          )}
          {badgeFacts(p).length > 0 && <p className="text-sm text-muted">{badgeFacts(p).join(" · ")}</p>}
        </div>
      </div>

      {(match.mutual || p.synthetic) && (
        <div className="flex flex-wrap gap-2">
          {match.mutual && (
            <span className="rounded-full bg-accent px-3 py-0.5 text-sm font-semibold text-on-accent">
              Looking for someone like you too
            </span>
          )}
          {p.synthetic && (
            <span className="rounded-full border-2 border-dashed border-border px-3 py-0.5 text-sm font-semibold">
              Synthetic profile<span className="sr-only">: a made-up demo attendee</span>
            </span>
          )}
        </div>
      )}

      {p.bio && (
        <div>
          <h3 className="text-xs font-semibold text-muted">About</h3>
          <p className="mt-1 leading-snug break-words">{p.bio}</p>
        </div>
      )}

      <p className="rounded-xl bg-accent/10 px-4 py-3 leading-snug">
        <span className="block text-xs font-semibold text-muted">Why them</span>
        {match.explanation}
      </p>

      {match.highlights.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-muted">Evidence</h3>
          <ul className="mt-1 flex flex-col gap-1.5">
            {match.highlights.map((h, i) => (
              <li key={i} className="border-l-4 border-[var(--badge)] pl-3 text-sm leading-snug break-words">
                {highlightParts(h).map((part, j) =>
                  part.hit ? (
                    <mark key={j} className="rounded bg-[var(--badge)] px-0.5 text-[var(--badge-ink)]">
                      {part.text}
                    </mark>
                  ) : (
                    <span key={j}>{part.text}</span>
                  ),
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {match.evidence.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-muted">Projects and papers</h3>
          <ul className="mt-1 flex flex-col gap-1.5" aria-label={`${p.name}'s projects and papers`}>
            {match.evidence.map((e, i) => (
              <li key={`${e.kind}-${e.title}-${i}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm leading-snug">
                <span className="shrink-0 rounded-md bg-[var(--skeleton)] px-2 py-0.5 text-xs font-semibold">
                  {evidenceKindLabel[e.kind]}
                </span>
                {e.url ? (
                  <a
                    href={e.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-w-0 font-medium break-words underline underline-offset-4 hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    {e.title}
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                ) : (
                  <span className="min-w-0 font-medium break-words">{e.title}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {(p.languages.length > 0 || p.organisations.length > 0) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {p.languages.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-muted">Works with</h3>
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {p.languages.map((l) => (
                  <li key={l} className="rounded-md bg-accent/15 px-2 py-0.5 text-xs font-medium">
                    {l}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {p.organisations.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-muted">Part of</h3>
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {p.organisations.map((o) => (
                  <li key={o} className="rounded-md bg-[var(--skeleton)] px-2 py-0.5 text-xs font-medium">
                    {o}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

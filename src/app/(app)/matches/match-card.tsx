/**
 * A match in the list (A2): a condensed row anyone can scan, and the full
 * profile it opens into. Hidden profile fields simply aren't there, and a
 * hidden hiring answer is never shown as "not hiring" (badgeFacts).
 */
import type { CSSProperties } from "react";
import type { EvidenceDoc, MatchResult } from "@/contracts/types";
import { personColour } from "@/components/ui/badge-colours";
import { githubProfile } from "@/components/ui/person-badge";
export { MatchSummary } from "@/components/ui/match-summary";
import { highlightParts } from "./matches";

// Includes profile enrichment's kinds. Assigned through a variable so it compiles before and after
// the contract adds them, while a kind without a label still fails typecheck.
const labels = {
  repo: "Repository",
  commit_area: "Code area",
  paper: "Paper",
  talk: "Talk",
  abstract: "Abstract",
  profile_page: "Profile page",
  cv: "CV",
};

/** What each kind of evidence is called on the open profile. */
export const evidenceKindLabel: Record<EvidenceDoc["kind"], string> = labels;

/** The full profile a row opens into: their badge, why them, the evidence, and what they work with. */
export function MatchDetails({
  match,
  nameId,
}: {
  match: MatchResult;
  nameId: string;
}) {
  const p = match.person;
  return (
    <div
      style={{ "--badge": personColour(p) } as CSSProperties}
      className="flex flex-col gap-4"
    >
      {/*
        The row above already shows their picture, name, handle, facts and labels; the open part
        adds the rest. The name stays as a hidden heading, so the panel is still named for screen
        readers.
      */}
      <h2 id={nameId} className="sr-only">
        {p.name}
      </h2>
      {p.githubLogin && (
        <a
          href={githubProfile(p.githubLogin)}
          target="_blank"
          rel="noopener noreferrer"
          className="w-fit text-sm font-semibold text-accent underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-accent"
        >
          Their GitHub profile
          <span className="sr-only">
            {" "}
            (@{p.githubLogin}, opens in a new tab)
          </span>
        </a>
      )}

      {p.bio && (
        <div>
          <h3 className="text-xs font-semibold text-muted">About</h3>
          <p className="mt-1 leading-snug break-words">{p.bio}</p>
        </div>
      )}

      <p className="rounded-xl bg-accent/10 px-4 py-3 leading-snug">
        <span className="block text-xs font-semibold">Why them</span>
        {match.explanation}
      </p>

      {match.highlights.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-muted">Evidence</h3>
          <ul className="mt-1 flex flex-col gap-1.5">
            {match.highlights.map((h, i) => (
              <li
                key={i}
                className="border-l-4 border-[var(--badge)] pl-3 text-sm leading-snug break-words"
              >
                {highlightParts(h).map((part, j) =>
                  part.hit ? (
                    <mark
                      key={j}
                      className="rounded bg-[var(--badge)] px-0.5 text-[var(--badge-ink)]"
                    >
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

      {(p.languages.length > 0 || p.organisations.length > 0) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {p.languages.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-muted">Works with</h3>
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {p.languages.map((l) => (
                  <li
                    key={l}
                    className="rounded-md bg-accent/15 px-2 py-0.5 text-xs font-medium"
                  >
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
                  <li
                    key={o}
                    className="rounded-md bg-[var(--skeleton)] px-2 py-0.5 text-xs font-medium"
                  >
                    {o}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {/* Last, so links to their work sit just above Pass and Send. */}
      {match.evidence.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-muted">
            Articles, projects and papers
          </h3>
          <ul
            className="mt-1 flex flex-col gap-1.5"
            aria-label={`${p.name}'s articles, projects and papers`}
          >
            {match.evidence.map((e, i) => (
              <li
                key={`${e.kind}-${e.title}-${i}`}
                className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm leading-snug"
              >
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
                  <span className="min-w-0 font-medium break-words">
                    {e.title}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

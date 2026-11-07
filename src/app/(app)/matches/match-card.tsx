/**
 * One result card (A2 step 1): who they are, why Convo picked them (the
 * explanation and the exact evidence), their hard-filter badges, whether
 * they're looking for someone like you too, and a "synthetic" label on
 * demo profiles. Readable as a whole by screen readers (an article named
 * by the person's name); hidden profile fields simply aren't shown.
 */
import type { CSSProperties } from "react";
import type { MatchResult } from "@/contracts/types";
import { personColour } from "@/components/ui/badge-colours";
import { PersonBadge } from "@/components/ui/person-badge";
import { highlightParts } from "./matches";

export function MatchCard({ match, position }: { match: MatchResult; position: string }) {
  const p = match.person;
  const nameId = `match-${p.id}-name`;
  const style = { "--badge": personColour(p) } as CSSProperties;

  return (
    <article
      aria-labelledby={nameId}
      aria-describedby={`${nameId}-pos`}
      style={style}
      className="overflow-hidden rounded-2xl bg-surface shadow-[var(--popover-shadow)] ring-1 ring-border"
    >
      <div className="flex h-9 items-center justify-between bg-[var(--badge)] px-4 text-[13px] font-semibold text-[var(--badge-ink)]">
        <span>Convo</span>
        <span id={`${nameId}-pos`} className="font-normal">
          {position}
        </span>
      </div>

      <div className="flex flex-col gap-4 px-5 pb-5 pt-4">
        <PersonBadge person={p} nameId={nameId} />

        {match.mutual && (
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full bg-accent px-3 py-0.5 text-sm font-semibold text-on-accent">
              Looking for someone like you too
            </span>
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
              {match.highlights.slice(0, 3).map((h, i) => (
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
      </div>
    </article>
  );
}

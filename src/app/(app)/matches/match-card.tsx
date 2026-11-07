/**
 * One result card (A2 step 1): who they are, why Lanyard picked them (the
 * explanation and the exact evidence), their hard-filter badges, whether
 * they're looking for someone like you too, and a "synthetic" label on
 * demo profiles. Readable as a whole by screen readers (an article named
 * by the person's name); hidden profile fields simply aren't shown.
 */
import type { CSSProperties } from "react";
import type { MatchResult } from "@/contracts/types";
import { badgeLabels, cardColour, highlightParts } from "./matches";

export function MatchCard({ match, position }: { match: MatchResult; position: string }) {
  const p = match.person;
  const nameId = `match-${p.id}-name`;
  const style = { "--badge": cardColour(p) } as CSSProperties;
  const badges = badgeLabels(match);

  return (
    <article
      aria-labelledby={nameId}
      aria-describedby={`${nameId}-pos`}
      style={style}
      className="overflow-hidden rounded-2xl bg-surface shadow-[var(--popover-shadow)] ring-1 ring-border"
    >
      <div className="flex h-9 items-center justify-between bg-[var(--badge)] px-4 text-[13px] font-semibold text-[var(--badge-ink)]">
        <span>Lanyard</span>
        <span id={`${nameId}-pos`} className="font-normal">
          {position}
        </span>
      </div>

      <div className="flex flex-col gap-4 px-5 pb-5 pt-4">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="size-14 shrink-0 rounded-full bg-accent/80" />
          <div className="min-w-0 flex-1">
            <h2 id={nameId} className="text-2xl font-extrabold leading-tight tracking-tight break-words [font-stretch:85%]">
              {p.name}
            </h2>
            <p className="truncate text-sm text-muted">@{p.githubLogin}</p>
          </div>
        </div>

        {(p.synthetic || match.mutual) && (
          <div className="flex flex-wrap gap-2">
            {p.synthetic && (
              <span className="rounded-full border-2 border-dashed border-border px-3 py-0.5 text-sm font-semibold">
                Synthetic profile<span className="sr-only">: a made-up demo attendee</span>
              </span>
            )}
            {match.mutual && (
              <span className="rounded-full bg-accent px-3 py-0.5 text-sm font-semibold text-on-accent">
                Looking for someone like you too
              </span>
            )}
          </div>
        )}

        {p.workplaceName && (
          <p>
            <span className="block text-xs text-muted">Works at</span>
            <span className="font-semibold break-words">{p.workplaceName}</span>
          </p>
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

        {(badges.length > 0 || p.languages.length > 0) && (
          <ul aria-label="Details" className="flex flex-wrap gap-1.5">
            {badges.map((b) => (
              <li key={`b-${b}`} className="rounded-md bg-[var(--skeleton)] px-2 py-0.5 text-xs font-semibold">
                {b}
              </li>
            ))}
            {p.languages.slice(0, 5).map((l) => (
              <li key={`l-${l}`} className="rounded-md bg-accent/15 px-2 py-0.5 text-xs font-medium">
                {l}
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}

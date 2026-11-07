/**
 * The other person on a request, as they chose to show themselves: the
 * asker on an inbox card, the receiver under "You asked". Their badge
 * colour, name and GitHub, workplace, country and hiring (hidden sections
 * aren't there), a line of bio and a few skills.
 */
import type { CSSProperties } from "react";
import type { CardPerson } from "@/contracts/types";
import { githubProfile } from "../matches/matches";
import { badgeColour, badgeFacts } from "./inbox";

export function PersonBadge({ person, caption }: { person: CardPerson | null; caption: string }) {
  if (!person) {
    return (
      <p className="text-sm text-muted">
        <span className="font-semibold">{caption}:</span> someone at the conference
      </p>
    );
  }
  const style = { "--badge": badgeColour(person) } as CSSProperties;
  const facts = badgeFacts(person);
  const chips = [...person.languages, ...person.organisations].slice(0, 4);
  return (
    <div style={style} className="flex gap-3 rounded-xl border-l-8 border-[var(--badge)] bg-background px-3 py-2.5">
      <span aria-hidden="true" className="mt-1 size-10 shrink-0 rounded-full bg-[var(--badge)]" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-muted">{caption}</p>
        <p className="font-bold leading-snug break-words">
          {person.name}{" "}
          <a
            href={githubProfile(person.githubLogin)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-accent underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-accent"
          >
            @{person.githubLogin}
            <span className="sr-only"> on GitHub (opens in a new tab)</span>
          </a>
        </p>
        {facts.length > 0 && <p className="text-sm text-muted">{facts.join(" · ")}</p>}
        {person.bio && <p className="mt-1 line-clamp-2 text-sm">{person.bio}</p>}
        {(person.synthetic || chips.length > 0) && (
          <ul aria-label={`About ${person.name}`} className="mt-1.5 flex flex-wrap gap-1.5">
            {person.synthetic && (
              <li className="rounded-md border-2 border-dashed border-border px-2 py-0.5 text-xs font-semibold">
                Synthetic profile<span className="sr-only">: a made-up demo attendee</span>
              </li>
            )}
            {chips.map((chip, i) => (
              <li key={`${i}-${chip}`} className="rounded-md bg-accent/15 px-2 py-0.5 text-xs font-medium">
                {chip}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

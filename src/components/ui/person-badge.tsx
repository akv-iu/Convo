/**
 * A person as they chose to show themselves, shared by match and request cards. Their badge
 * colour, name and GitHub, workplace, country and hiring (hidden sections
 * aren't there), a line of bio and a few skills.
 */
import type { CSSProperties } from "react";
import type { CardPerson } from "@/contracts/types";
import { Avatar } from "./avatars";
import { personColour, pictureColour } from "./badge-colours";
import { countryName } from "./countries";

export function githubProfile(login: string): string {
  return `https://github.com/${encodeURIComponent(login)}`;
}

export function badgeFacts(person: CardPerson): string[] {
  const facts: string[] = [];
  if (person.workplaceName) facts.push(person.workplaceName);
  if (person.filters.country) facts.push(countryName(person.filters.country));
  if (person.filters.hiring !== null) facts.push(person.filters.hiring ? "Hiring" : "Not hiring");
  return facts;
}

export function PersonBadge({ person, caption, nameId }: { person: CardPerson | null; caption?: string; nameId?: string }) {
  if (!person) {
    return (
      <p className="text-sm text-muted">
        {caption && <span className="font-semibold">{caption}: </span>}someone at the conference
      </p>
    );
  }
  const style = { "--badge": personColour(person) } as CSSProperties;
  const facts = badgeFacts(person);
  const chips = [...person.languages, ...person.organisations].slice(0, 4);
  const Name = nameId ? "h2" : "p";
  return (
    <div style={style} className="flex gap-3 rounded-xl border-l-8 border-[var(--badge)] bg-background px-3 py-2.5">
      <Avatar avatar={person.avatar} name={person.name} colour={pictureColour(person)} className="mt-1 size-10 text-sm" />
      <div className="min-w-0 flex-1">
        {caption && <p className="text-xs font-semibold text-muted">{caption}</p>}
        <Name id={nameId} className={`font-bold leading-snug break-words${nameId ? " text-2xl tracking-tight" : ""}`}>
          {person.name}
        </Name>
        <a
          href={githubProfile(person.githubLogin)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium text-accent underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-accent"
        >
          @{person.githubLogin}
          <span className="sr-only"> on GitHub (opens in a new tab)</span>
        </a>
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

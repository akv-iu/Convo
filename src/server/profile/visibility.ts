import { ProfileVisibility, type CardPerson, type MatchResult, type Person } from "@/contracts/types";

const SHOW_ALL: ProfileVisibility = { country: true, workplace: true, hiring: true };

/** A person as other people see them: hidden sections are null, and which ones were hidden stays private. */
export function visiblePerson(person: Person | CardPerson, visibility = person.visibility): CardPerson {
  const shown = ProfileVisibility.parse(visibility ?? SHOW_ALL);
  // The owner's settings stay private: a card must not reveal which sections were hidden.
  const rest = { ...person };
  delete rest.visibility;
  return {
    ...rest,
    workplaceName: shown.workplace ? person.workplaceName : null,
    filters: {
      country: shown.country ? person.filters.country : null,
      rorId: shown.workplace ? person.filters.rorId : null,
      hiring: shown.hiring ? person.filters.hiring : null,
    },
  };
}

export function visibleCard(match: MatchResult, visibility = match.person.visibility): MatchResult {
  const shown = ProfileVisibility.parse(visibility ?? SHOW_ALL);
  return {
    ...match,
    person: visiblePerson(match.person, shown),
    badges: match.badges.filter(badge =>
      (shown.country || badge !== match.person.filters.country) &&
      (shown.hiring || (badge !== "hiring" && badge !== "not hiring"))),
  };
}

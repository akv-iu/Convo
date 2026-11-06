import { ProfileVisibility, type MatchResult } from "@/contracts/types";

export function visibleCard(match: MatchResult, visibility = match.person.visibility): MatchResult {
  const shown = ProfileVisibility.parse(visibility ?? { country: true, workplace: true, hiring: true });
  return {
    ...match,
    person: {
      ...match.person,
      visibility: shown,
      workplaceName: shown.workplace ? match.person.workplaceName : null,
      filters: {
        country: shown.country ? match.person.filters.country : null,
        rorId: shown.workplace ? match.person.filters.rorId : null,
        hiring: shown.hiring ? match.person.filters.hiring : null,
      },
    },
    badges: match.badges.filter(badge =>
      (shown.country || badge !== match.person.filters.country) &&
      (shown.hiring || (badge !== "hiring" && badge !== "not hiring"))),
  };
}

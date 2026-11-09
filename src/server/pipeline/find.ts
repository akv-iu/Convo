/**
 * The person finder over everyone (the Find tab): no question, no AI. The same strict rules as
 * ./narrow: a country's name keeps people who show that country; anything else keeps people whose
 * shown workplace, organisations or skills contain it as whole words. Only what a person shows
 * counts, so a hidden country or workplace can't be found (or revealed) by searching for it.
 */
import type { CardPerson, Person, ProfileVisibility } from "@/contracts/types";
import { visiblePerson } from "@/server/profile/visibility";
import { narrowTo, readNarrowing } from "./narrow";

export const FIND_LIMIT = 50;
const HIDE_ALL: ProfileVisibility = { country: false, workplace: false, hiring: false };

/**
 * Filters `everyone` for the box's text. `accounts` are signed-up people as saved (they decide what
 * they show); a search copy of a real account never decides it, so without its account it shows
 * nothing. Synthetic people exist only in search and show what their profile says.
 */
export function findIn(everyone: Person[], accounts: Map<string, Person>, query: string, userId: string): CardPerson[] {
  if (!query.trim()) return [];
  const fits = narrowTo(readNarrowing(query));
  const seen = new Set<string>();
  const found: Person[] = [];
  for (const copy of everyone) {
    if (copy.id === userId || seen.has(copy.id)) continue;
    seen.add(copy.id);
    const person = accounts.get(copy.id) ?? (copy.synthetic ? copy : { ...copy, visibility: HIDE_ALL });
    if (fits(person)) found.push(person);
  }
  // Real people first, then by name, so the list doesn't shuffle between searches.
  found.sort((a, b) => Number(Boolean(a.synthetic)) - Number(Boolean(b.synthetic)) || a.name.localeCompare(b.name));
  return found.slice(0, FIND_LIMIT).map((p) => visiblePerson(p));
}

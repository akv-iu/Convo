/**
 * The matches screen's search box, read for places as well as topics. A country's name ("Spain",
 * "united kingdom") or the name of a workplace or organisation ("University", "Grafana Labs")
 * narrows the list to people who show that country, workplace or organisation. Anything else
 * stays a search for topics, as before.
 *
 * Only what a person shows counts: a hidden country or workplace is never matched, so searching
 * for it can't reveal it. GitHub organisations are always on the card, so they always count.
 */
import { countries } from "@/components/ui/countries";
import type { Person } from "@/contracts/types";

export interface Narrowing {
  /** A country the box named (ISO code), or null. */
  country: string | null;
  /** The rest of the box: topics, or a workplace or organisation name. */
  rest: string;
}

const words = (text: string) => text.toLocaleLowerCase("en").split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const phrase = (text: string) => ` ${words(text).join(" ")} `;

/** Countries by name, longest first, so "Guinea-Bissau" wins over "Guinea". */
const COUNTRY_NAMES = countries
  .map(({ code, name }) => ({ code, name: phrase(name) }))
  .sort((a, b) => b.name.length - a.name.length);

/** Splits the box into a country (if it names one) and the rest. */
export function readNarrowing(query: string): Narrowing {
  const text = phrase(query);
  const hit = COUNTRY_NAMES.find(({ name }) => text.includes(name));
  if (!hit) return { country: null, rest: query.trim() };
  return { country: hit.code, rest: text.replace(hit.name, " ").trim() };
}

/** The workplace and organisation names a person shows on their card. */
function shownPlaces(person: Person): string[] {
  const shown = person.visibility?.workplace !== false && person.workplaceName ? [person.workplaceName] : [];
  return [...shown, ...person.organisations];
}

/** True when one of the person's shown places contains the phrase as whole words ("University" in "University of Oxford"). */
export function showsPlace(person: Person, place: string): boolean {
  const wanted = phrase(place);
  return wanted.trim().length > 0 && shownPlaces(person).some((name) => phrase(name).includes(wanted));
}

/** True when the person shows that country. */
export function showsCountry(person: Person, code: string): boolean {
  return person.visibility?.country !== false && person.filters.country === code;
}

/**
 * Who the box lets through. A country always narrows. The rest narrows to a place only when
 * someone in the list shows that place; otherwise it was a topic, and searching already used it.
 */
export function narrowTo(people: Person[], narrowing: Narrowing): (person: Person) => boolean {
  const byPlace = narrowing.rest !== "" && people.some((p) => showsPlace(p, narrowing.rest));
  return (person) =>
    (narrowing.country === null || showsCountry(person, narrowing.country)) &&
    (!byPlace || showsPlace(person, narrowing.rest));
}

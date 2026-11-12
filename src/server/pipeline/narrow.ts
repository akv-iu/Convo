/**
 * The matches screen's search box, read for places as well as topics. A country's name ("Spain",
 * "united kingdom") or a workplace's name ("University", "Grafana Labs") narrows the list to people
 * who show that country or workplace. Anything else, GitHub organisations included (they are
 * usually topic words: "kubernetes", "rust-lang"), stays a search for topics, as before.
 *
 * Only what a person shows counts: a hidden country or workplace is never matched, so searching
 * for it can't reveal it.
 */
import { countries } from "@/components/ui/countries";
import type { Person } from "@/contracts/types";

export interface Narrowing {
  /** A country the box named (ISO code), or null. */
  country: string | null;
  /** The rest of the box: topics, or a workplace name. */
  rest: string;
  /** The whole box, for a workplace with a country in its name ("Georgia Tech"). */
  query: string;
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
  if (!hit) return { country: null, rest: query.trim(), query: query.trim() };
  return { country: hit.code, rest: text.replace(hit.name, " ").trim(), query: query.trim() };
}

/** True when the person's shown workplace contains the phrase as whole words ("University" in "University of Oxford"). */
export function showsPlace(person: Person, place: string): boolean {
  const wanted = phrase(place);
  return wanted.trim().length > 0 && person.visibility?.workplace !== false && !!person.workplaceName && phrase(person.workplaceName).includes(wanted);
}

/** True when the person shows that country. */
export function showsCountry(person: Person, code: string): boolean {
  return person.visibility?.country !== false && person.filters.country === code;
}

/**
 * Who the box lets through. A country narrows, unless the whole box is a workplace someone shows
 * ("Georgia Tech", not Georgia plus "tech"). The rest narrows to a workplace only when someone in
 * the list shows it; otherwise it was a topic, and searching already used it.
 */
export function narrowTo(people: Person[], narrowing: Narrowing): (person: Person) => boolean {
  const wholeIsPlace = narrowing.country !== null && narrowing.rest !== "" && people.some((p) => showsPlace(p, narrowing.query));
  const country = wholeIsPlace ? null : narrowing.country;
  const place = wholeIsPlace ? narrowing.query : narrowing.rest;
  const byPlace = place !== "" && people.some((p) => showsPlace(p, place));
  return (person) => (country === null || showsCountry(person, country)) && (!byPlace || showsPlace(person, place));
}

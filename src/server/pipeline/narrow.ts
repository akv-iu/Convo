/**
 * The person finder: the "Find people who can help" box on the matches screen. It is a strict
 * filter on the request matcher's list. A country's name ("Spain", "united kingdom") keeps people
 * who show that country; anything else ("University", "University of Utah", "Grafana Labs", "Rust")
 * keeps people whose shown workplace, organisations or skills contain it as whole words. If no one
 * fits, no one is shown: the finder never falls back to a looser search.
 *
 * Only what a person shows counts: a hidden country or workplace is never matched, so searching
 * for it can't reveal it. GitHub organisations and skills are always on the card, so they always count.
 */
import { countries } from "@/components/ui/countries";
import type { Person } from "@/contracts/types";
import { expertiseOf } from "@/server/search/evidence";

export interface Narrowing {
  /** A country the box named (ISO code), or null. */
  country: string | null;
  /** The rest of the box: a workplace, organisation or skill. */
  rest: string;
  /** The whole box, for a workplace with a country in its name ("University of Georgia"). */
  query: string;
}

const words = (text: string) => text.toLocaleLowerCase("en").split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const phrase = (text: string) => ` ${words(text).join(" ")} `;

/** Words that only join a place's name to the box ("people at", "in", "from"); they never have to match. */
const LINKING = new Set(["at", "in", "from", "people", "who", "work", "works", "working", "with", "and", "the"]);

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

/** The workplace, organisations and skills a person shows on their card. */
function shownLabels(person: Person): string[] {
  const workplace = person.visibility?.workplace !== false && person.workplaceName ? [person.workplaceName] : [];
  return [...workplace, ...person.organisations, ...person.languages, ...expertiseOf(person)];
}

/** The box's words that have to match, without the linking ones ("people at"). */
function wanted(text: string): string {
  const kept = words(text).filter((w) => !LINKING.has(w));
  return kept.length ? ` ${kept.join(" ")} ` : "";
}

/**
 * True when one of the person's shown labels contains the phrase as whole words: "University"
 * and "University of Utah" in "University of Utah", "Go" in Go but not in "Grafana".
 */
export function showsPlace(person: Person, place: string): boolean {
  const target = wanted(place);
  return target !== "" && shownLabels(person).some((label) => phrase(label).includes(target));
}

/** True when the person shows that country. */
export function showsCountry(person: Person, code: string): boolean {
  return person.visibility?.country !== false && person.filters.country === code;
}

/**
 * Who the box lets through: everything named must fit, country and the rest alike. A box that is
 * also a whole place someone shows ("University of Georgia") fits them as that place, too.
 */
export function narrowTo(narrowing: Narrowing): (person: Person) => boolean {
  const rest = wanted(narrowing.rest);
  const whole = narrowing.country !== null && rest !== "";
  return (person) =>
    ((narrowing.country === null || showsCountry(person, narrowing.country)) && (rest === "" || showsPlace(person, narrowing.rest))) ||
    (whole && showsPlace(person, narrowing.query));
}

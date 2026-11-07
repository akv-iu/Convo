/**
 * The editable parts of the profile card and how edits become a
 * PUT /api/me body. B2's handoff (db/Profile-API.md): after onboarding,
 * send only the fields that changed.
 */
import type { RouteBody } from "@/contracts/routes";
import type { CardPerson, Person, ProfileVisibility } from "@/contracts/types";

export interface Draft {
  name: string;
  bio: string;
  languages: string[];
  organisations: string[];
}

export const LIMITS = {
  name: 80,
  bio: 280,
  chip: 40,
  chips: 12,
} as const;

export function draftFrom(person: Person): Draft {
  return {
    name: person.name,
    bio: person.bio,
    languages: [...person.languages],
    organisations: [...person.organisations],
  };
}

/**
 * Adds a chip: trimmed, at most LIMITS.chip characters, no case-insensitive
 * duplicates, at most LIMITS.chips in total. Returns the list unchanged when
 * the value can't be added, with the reason.
 */
export const DUPLICATE_CHIP = "That's already on your badge.";

export function addChip(list: string[], raw: string): { list: string[]; problem: string | null } {
  const value = raw.trim().replace(/\s+/g, " ");
  if (!value) return { list, problem: null };
  if (value.length > LIMITS.chip) return { list, problem: `Keep it under ${LIMITS.chip} characters.` };
  if (list.some((v) => v.toLowerCase() === value.toLowerCase())) return { list, problem: DUPLICATE_CHIP };
  if (list.length >= LIMITS.chips) return { list, problem: `You can add up to ${LIMITS.chips}.` };
  return { list: [...list, value], problem: null };
}

/**
 * On save, text still in an Add box is added as if Add was pressed, so it
 * isn't silently lost. A duplicate is already on the badge, so it's simply
 * dropped; any other problem stops the save with that message.
 */
export function addPending(list: string[], raw: string): { list: string[]; problem: string | null } {
  const result = addChip(list, raw);
  return result.problem === DUPLICATE_CHIP ? { list, problem: null } : result;
}

export function removeChip(list: string[], value: string): string[] {
  return list.filter((v) => v !== value);
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/** The PUT body: only fields that differ from what was loaded. Empty when nothing changed. */
export function changesFrom(original: Draft, draft: Draft): RouteBody<"putMe"> {
  const patch: RouteBody<"putMe"> = {};
  const name = draft.name.trim();
  const bio = draft.bio.trim();
  if (name !== original.name) patch.name = name;
  if (bio !== original.bio) patch.bio = bio;
  if (!sameList(draft.languages, original.languages)) patch.languages = draft.languages;
  if (!sameList(draft.organisations, original.organisations)) patch.organisations = draft.organisations;
  return patch;
}

export function nameProblem(draft: Draft): string | null {
  const name = draft.name.trim();
  if (!name) return "Add the name people should see.";
  if (name.length > LIMITS.name) return `Keep your name under ${LIMITS.name} characters.`;
  return null;
}

/** What a failed load should tell the user, and where to send them. */
export function loadProblem(status: number): { message: string; action: { label: string; href: string } | null } {
  if (status === 401 || status === 404)
    return { message: "Your sign-in has expired.", action: { label: "Sign in again", href: "/signin" } };
  if (status === 409)
    return { message: "Start with your name, workplace and country.", action: { label: "Go to About you", href: "/signin" } };
  return { message: "Your profile didn't load. Try again in a moment.", action: null };
}

/**
 * You as other people see you in their matches: the sections you hid come
 * through empty, the same way the server sends them (db/Frontend-Support.md).
 */
export function asSeenByOthers(person: Person, visibility: ProfileVisibility): CardPerson {
  return {
    ...person,
    workplaceName: visibility.workplace ? (person.workplaceName ?? null) : null,
    filters: {
      country: visibility.country ? person.filters.country : null,
      rorId: visibility.workplace ? person.filters.rorId : null,
      hiring: visibility.hiring ? person.filters.hiring : null,
    },
  };
}

/** Everything shown, for profiles saved before show/hide existed. */
export const SHOW_ALL: ProfileVisibility = { country: true, workplace: true, hiring: true };

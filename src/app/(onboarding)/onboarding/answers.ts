/**
 * Onboarding answers and how they become PUT /api/me. Step 1 asks name,
 * workplace and country; step 2 adds hiring and saves everything together,
 * because B2's API needs country, workplace and hiring in one complete
 * `filters` object (db/Profile-API.md).
 */
import type { BadgeColour, HardFilters, ProfileVisibility, RorMatch } from "@/contracts/types";
import { isCountryCode } from "@/components/ui/countries";

/**
 * No choice yet, a workplace from the directory (ROR), one the user typed
 * because it isn't listed, or "not with an organisation".
 */
export type Workplace =
  | null
  /** `unnamed`: restored from an older profile that kept only the ROR ID, so org.name is a placeholder. */
  | { kind: "org"; org: RorMatch; unnamed?: true }
  | { kind: "custom"; name: string }
  | { kind: "none" };

/** A typed workplace name is stored as Person.workplaceName: trimmed, 1 to 200 characters. */
export const WORKPLACE_NAME_MAX = 200;

export interface AboutYou {
  name: string;
  workplace: Workplace;
  country: string;
}

export interface Answers extends AboutYou {
  hiring: boolean | null;
}

export type Missing = "name" | "workplace" | "country" | "hiring";

export const NAME_MAX = 80;

export const missingMessage: Record<Missing, string> = {
  name: "Add the name people should see.",
  workplace: "Choose where you work, or pick Not with an organisation.",
  country: "Choose the country you're based in.",
  hiring: "Say whether you're hiring.",
};

/** Step 1's unanswered questions, in screen order. */
export function aboutYouMissing(a: AboutYou): Missing[] {
  const missing: Missing[] = [];
  const name = a.name.trim();
  if (!name || name.length > NAME_MAX) missing.push("name");
  if (!a.workplace || (a.workplace.kind === "custom" && !validWorkplaceName(a.workplace.name))) missing.push("workplace");
  if (!isCountryCode(a.country)) missing.push("country");
  return missing;
}

/** Everything still missing before the profile can be saved. */
export function missingAnswers(a: Answers): Missing[] {
  const missing = aboutYouMissing(a);
  if (a.hiring === null) missing.push("hiring");
  return missing;
}

/** The filters object for PUT /api/me; only call once nothing is missing. */
export function toFilters(a: Answers): HardFilters {
  if (missingAnswers(a).length) throw new Error("Answers are incomplete");
  return {
    country: a.country.toUpperCase(),
    rorId: a.workplace?.kind === "org" ? a.workplace.org.id : null,
    hiring: a.hiring === true,
  };
}

function validWorkplaceName(name: string): boolean {
  const t = name.trim();
  return t.length > 0 && t.length <= WORKPLACE_NAME_MAX;
}

/** Person.workplaceName for a workplace answer: the label people see on the card. */
export function workplaceName(w: Workplace): string | null {
  if (!w || w.kind === "none") return null;
  if (w.kind === "custom") return w.name.trim();
  return w.unnamed ? null : w.org.name; // never save the placeholder as a real name
}

/** Everything visible by default (true = shown on other people's cards). */
export const SHOW_ALL: ProfileVisibility = { country: true, workplace: true, hiring: true };

/**
 * The whole PUT /api/me body for step 2 (db/Frontend-Support.md): name,
 * complete filters, the workplace label, badge colour and the complete
 * visibility object. Only call once nothing is missing.
 */
export function toProfileBody(a: Answers, badgeColour: BadgeColour, visibility: ProfileVisibility) {
  return {
    name: a.name.trim(),
    filters: toFilters(a),
    workplaceName: workplaceName(a.workplace),
    badgeColour,
    visibility,
  };
}

/** Step 1's answers rebuilt from a saved profile. */
export function aboutFromProfile(p: {
  name: string;
  filters: HardFilters;
  workplaceName?: string | null;
}): AboutYou {
  const label = p.workplaceName ?? null;
  let workplace: Workplace;
  if (p.filters.rorId) {
    // Older profiles kept only the directory ID.
    workplace = label
      ? { kind: "org", org: { id: p.filters.rorId, name: label, country: p.filters.country } }
      : { kind: "org", org: { id: p.filters.rorId, name: "Your saved workplace", country: p.filters.country }, unnamed: true };
  } else if (label) {
    workplace = { kind: "custom", name: label };
  } else {
    workplace = { kind: "none" };
  }
  return { name: p.name, country: p.filters.country, workplace };
}

/** What the badge shows for a workplace answer. */
export function workplaceLabel(w: Workplace): string | null {
  if (!w) return null;
  if (w.kind === "none") return "Independent";
  return w.kind === "org" ? w.org.name : w.name.trim();
}

/** What a failed save should tell the user, from the API's status and `{ error }` body. */
export function saveErrorMessage(status: number, body: unknown): string {
  const serverMessage =
    typeof body === "object" && body && "error" in body && typeof body.error === "string" ? body.error : null;
  // 404: the profile row is gone ("Profile not found. Sign in again."), so retrying can never work.
  if (status === 401 || status === 404) return "Your sign-in has expired. Sign in again to save your answers.";
  if (status === 503) return serverMessage ?? "Saving failed for a moment. Try again.";
  if (status === 400) return "One of the answers wasn't accepted. Check them and try again.";
  return "Your answers weren't saved. Try again.";
}

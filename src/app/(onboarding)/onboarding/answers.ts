/**
 * Onboarding answers and how they become PUT /api/me. Step 1 asks name,
 * workplace and country; step 2 adds hiring and saves everything together,
 * because B2's API needs country, workplace and hiring in one complete
 * `filters` object (db/Profile-API.md).
 */
import type { HardFilters, RorMatch } from "@/contracts/types";
import { isCountryCode } from "./countries";

/** No choice yet, a ROR workplace, or "not with an organisation". */
export type Workplace = null | { kind: "org"; org: RorMatch } | { kind: "none" };

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
  if (!a.workplace) missing.push("workplace");
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

/** What the badge shows for a workplace answer. */
export function workplaceLabel(w: Workplace): string | null {
  if (!w) return null;
  return w.kind === "org" ? w.org.name : "Independent";
}

/** What a failed save should tell the user, from the API's status and `{ error }` body. */
export function saveErrorMessage(status: number, body: unknown): string {
  const serverMessage =
    typeof body === "object" && body && "error" in body && typeof body.error === "string" ? body.error : null;
  if (status === 401) return "Your sign-in has expired. Sign in again to save your answers.";
  if (status === 503) return serverMessage ?? "Saving failed for a moment. Try again.";
  if (status === 400) return "One of the answers wasn't accepted. Check them and try again.";
  return "Your answers weren't saved. Try again.";
}

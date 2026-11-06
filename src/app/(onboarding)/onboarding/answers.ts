/**
 * The three onboarding answers, checked before they are sent as
 * `filters` in PUT /api/me (all three together, as B2's API requires).
 */
import type { HardFilters, RorMatch } from "@/contracts/types";
import { isCountryCode } from "./countries";

/** No choice yet, a ROR workplace, or "not with an organisation". */
export type Workplace = null | { kind: "org"; org: RorMatch } | { kind: "none" };

export interface Answers {
  workplace: Workplace;
  country: string;
  hiring: boolean | null;
}

export type Missing = "workplace" | "country" | "hiring";

export const questionOrder: Missing[] = ["workplace", "country", "hiring"];

export const missingMessage: Record<Missing, string> = {
  workplace: "Choose where you work, or pick Not with an organisation.",
  country: "Choose the country you're based in.",
  hiring: "Say whether you're hiring.",
};

/** Which questions still need an answer, in screen order. */
export function missingAnswers(a: Answers): Missing[] {
  const missing: Missing[] = [];
  if (!a.workplace) missing.push("workplace");
  if (!isCountryCode(a.country)) missing.push("country");
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

/** What a failed save should tell the user, from the API's status and `{ error }` body. */
export function saveErrorMessage(status: number, body: unknown): string {
  const serverMessage =
    typeof body === "object" && body && "error" in body && typeof body.error === "string" ? body.error : null;
  if (status === 401) return "Your sign-in has expired. Sign in again to save your answers.";
  if (status === 503) return serverMessage ?? "Saving failed for a moment. Try again.";
  if (status === 400) return "One of the answers wasn't accepted. Check them and try again.";
  return "Your answers weren't saved. Try again.";
}

/**
 * What the user agreed Convo may read from GitHub, chosen on the sign-in
 * screen before GitHub is ever contacted. Stored in a cookie so the profile
 * builder (B2) can read it after the GitHub redirect and skip any source
 * the user left out.
 */
export const CONSENT_COOKIE = "convo_consent";

export const consentSources = [
  {
    id: "profile",
    label: "Your bio and public profile",
    hint: "Shown on your profile card. You can edit it on the next screens.",
  },
  {
    id: "repos",
    label: "Your public repositories and their languages",
    hint: "The evidence that shows people what you can help with.",
  },
  {
    id: "orgs",
    label: "Organisations you publicly belong to",
    hint: "Helps match you with people from the same projects.",
  },
] as const;

export type ConsentSource = (typeof consentSources)[number]["id"];

const ids = new Set<string>(consentSources.map((s) => s.id));

/** Parse the cookie value ("profile,repos") into the sources it names. */
export function parseConsent(value: string | undefined): ConsentSource[] {
  if (!value) return [];
  return value.split(",").filter((v): v is ConsentSource => ids.has(v));
}

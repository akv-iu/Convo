/**
 * The optional GitHub sources the sign-in screen asks about, with their
 * on-screen wording.
 *
 * Integration with B2 (see db/Consent.md):
 * - The screen saves the choice in the `convo_consent` cookie before the
 *   GitHub redirect: httpOnly, SameSite=Lax, path /, secure in production.
 * - The value is a comma-separated list of `profile`, `repos` and `orgs`;
 *   empty means every optional source was declined.
 * - B2 reads it during GitHub profile import and skips declined sources.
 *   The cookie name and the IDs come from B2's module so the two sides
 *   cannot drift apart.
 *
 * Verified here with the fake API only. Real GitHub sign-in with B2's
 * enforcement is covered by B2's tests and manual check, not by A1's.
 */
import { CONSENT_COOKIE, consentSources as consentIds } from "@/server/profile/consent";

export { CONSENT_COOKIE };

export type ConsentSource = (typeof consentIds)[number];

const wording: Record<ConsentSource, { label: string; hint: string }> = {
  profile: {
    label: "Your bio and public profile",
    hint: "Shown on your profile card. You can edit it on the next screens.",
  },
  repos: {
    label: "Your public repositories and their languages",
    hint: "The evidence that shows people what you can help with.",
  },
  orgs: {
    label: "Organisations you publicly belong to",
    hint: "Helps match you with people from the same projects.",
  },
};

export const consentSources = consentIds.map((id) => ({ id, ...wording[id] }));

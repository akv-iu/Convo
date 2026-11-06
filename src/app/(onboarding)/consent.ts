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
  profile: { label: "Bio", hint: "Your GitHub bio, as a starting point you can edit." },
  repos: { label: "Repos and languages", hint: "Your public work: the evidence people see." },
  orgs: { label: "Organisations", hint: "Projects you publicly belong to." },
};

export const consentSources = consentIds.map((id) => ({ id, ...wording[id] }));

"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { signIn } from "@/server/auth";
import { config } from "@/server/config";
import { BADGE_COOKIE, badgeCookieOptions, isBadgeColour, parseBadgePrefs, serializeBadgePrefs } from "../_components/badge-prefs";
import { CONSENT_COOKIE, consentSources } from "../consent";

const NEXT_STEP = "/onboarding";

/**
 * Save the consent choices and the badge colour, then hand over to GitHub
 * (or skip it on the fake API). The colour cookie is frontend-only; the
 * backend doesn't read it.
 */
export async function continueWithGitHub(formData: FormData) {
  const chosen = consentSources.map((s) => s.id).filter((id) => formData.get(id) === "on");

  const store = await cookies();
  store.set(CONSENT_COOKIE, chosen.join(","), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 7,
  });

  const colour = formData.get("colour");
  if (isBadgeColour(colour)) {
    const prefs = parseBadgePrefs(store.get(BADGE_COOKIE)?.value);
    store.set(BADGE_COOKIE, serializeBadgePrefs({ ...prefs, colour }), badgeCookieOptions);
  }

  if (config.fakeApi) redirect(NEXT_STEP);
  await signIn("github", { redirectTo: NEXT_STEP });
}

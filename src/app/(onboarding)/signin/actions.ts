"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { signIn } from "@/server/auth";
import { config } from "@/server/config";
import { CONSENT_COOKIE, consentSources } from "../consent";

const NEXT_STEP = "/onboarding";

/**
 * Save which GitHub sources Convo may use, then hand over to GitHub (or skip
 * it on the fake API). Only the sources the user left ticked are written, in
 * B2's consent cookie format (db/Consent.md); none ticked writes an empty
 * value, which still signs in with basic identity. Step 1's name, country
 * and workplace stay in the browser until step 2 saves them.
 */
export async function continueWithGitHub(formData: FormData) {
  const github = formData.get("github") === "on";
  // GitHub is the only sign-in for now; the form refuses to continue without it.
  if (!github) redirect("/signin");

  const ticked = new Set(formData.getAll("consent"));
  const chosen = consentSources.map((s) => s.id).filter((id) => ticked.has(id));

  const store = await cookies();
  store.set(CONSENT_COOKIE, chosen.join(","), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 7,
  });

  if (config.fakeApi) redirect(NEXT_STEP);
  await signIn("github", { redirectTo: NEXT_STEP });
}

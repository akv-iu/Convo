"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { signIn } from "@/server/auth";
import { config } from "@/server/config";
import { CONSENT_COOKIE, consentSources } from "../consent";

const NEXT_STEP = "/onboarding";

/**
 * Save which sources Convo may use, then hand over to GitHub (or skip it on
 * the fake API). GitHub on means all of its public sources (bio, repos,
 * orgs), written in B2's consent cookie format; off means none. Step 1's
 * name, country and workplace stay in the browser until step 2 saves them.
 */
export async function continueWithGitHub(formData: FormData) {
  const github = formData.get("github") === "on";
  // GitHub is the only sign-in for now; the form refuses to continue without it.
  if (!github) redirect("/signin");

  const store = await cookies();
  store.set(CONSENT_COOKIE, consentSources.map((s) => s.id).join(","), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 7,
  });

  if (config.fakeApi) redirect(NEXT_STEP);
  await signIn("github", { redirectTo: NEXT_STEP });
}

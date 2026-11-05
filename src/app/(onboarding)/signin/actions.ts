"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { signIn } from "@/server/auth";
import { config } from "@/server/config";
import { CONSENT_COOKIE, consentSources } from "../consent";

const NEXT_STEP = "/onboarding";

/** Save the consent choices, then hand over to GitHub (or skip it on the fake API). */
export async function continueWithGitHub(formData: FormData) {
  const chosen = consentSources.map((s) => s.id).filter((id) => formData.get(id) === "on");

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

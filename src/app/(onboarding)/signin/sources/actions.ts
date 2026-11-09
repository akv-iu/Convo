"use server";

import { redirect } from "next/navigation";
import { ENRICHMENT_RETURN_PATH } from "@/contracts/enrichment";
import { signIn } from "@/server/auth";
import { config } from "@/server/config";

/**
 * Page two's sign-in buttons. Sign-in only creates or opens the account; no
 * import starts here. Every outcome comes back to page two (B2's auth uses
 * the same ENRICHMENT_RETURN_PATH, adding ?reason= on cancel or refusal).
 */
async function startSignIn(provider: "google" | "github") {
  if (!config.profileEnrichmentEnabled) redirect("/signin");
  // The fake API has no OAuth: its demo identity is already signed in.
  if (config.fakeApi) redirect(ENRICHMENT_RETURN_PATH);
  await signIn(provider, { redirectTo: ENRICHMENT_RETURN_PATH });
}

export async function signInWithGoogle() {
  await startSignIn("google");
}

export async function signInWithGitHub() {
  await startSignIn("github");
}

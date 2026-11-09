import type { Metadata } from "next";
import { connection } from "next/server";
import { BackLink } from "@/components/ui/back-link";
import { config } from "@/server/config";
import { Steps } from "../../_components/steps";
import { ProfileForm } from "./profile-form";
import { ReviewForm } from "./review-form";

export const metadata: Metadata = { title: "Your details" };

// Rendered per request, so the profile enrichment switch is read at run time rather than built in.
export const instant = false;

/**
 * Step 4: "Are these the correct details?". With profile enrichment on it's step 5,
 * and first reviews the bio Lanyard drafted from the chosen sources.
 */
export default async function ProfilePage() {
  await connection();
  const enrichment = config.profileEnrichmentEnabled;
  return (
    <>
      <BackLink href="/onboarding/free-time" label="Back to Free time" />
      <Steps current={enrichment ? 5 : 4} flow={enrichment ? "enrichment" : "classic"} />
      {enrichment ? <ReviewForm /> : <ProfileForm />}
    </>
  );
}

import type { Metadata } from "next";
import { connection } from "next/server";
import { BackLink } from "@/components/ui/back-link";
import { config } from "@/server/config";
import { Steps } from "../../_components/steps";
import { FreeTimeForm } from "./free-time-form";

export const metadata: Metadata = { title: "Free time" };

// Rendered per request, so the profile enrichment switch is read at run time rather than built in.
export const instant = false;

/** Step 3: pick the half-hour blocks you're free to meet. With profile enrichment on it's step 4 of 5. */
export default async function FreeTimePage() {
  await connection();
  const enrichment = config.profileEnrichmentEnabled;
  return (
    <>
      <BackLink href="/onboarding" label="Back to Your badge" />
      <Steps current={enrichment ? 4 : 3} flow={enrichment ? "enrichment" : "classic"} />
      <FreeTimeForm enrichment={enrichment} />
    </>
  );
}

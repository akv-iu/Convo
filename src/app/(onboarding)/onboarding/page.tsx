import type { Metadata } from "next";
import { connection } from "next/server";
import { BackLink } from "@/components/ui/back-link";
import { ENRICHMENT_RETURN_PATH } from "@/contracts/enrichment";
import { config } from "@/server/config";
import { Steps } from "../_components/steps";
import { BadgeForm } from "./badge-form";

export const metadata: Metadata = { title: "Your badge" };

// Rendered per request, so the profile enrichment switch is read at run time rather than built in.
export const instant = false;

/**
 * Step 2: the badge card, hiring, colour and what to show. Saves steps 1 and 2 together.
 * With profile enrichment on it's step 3 of 5, after sign-in and sources, while the import runs.
 */
export default async function BadgePage() {
  await connection();
  const enrichment = config.profileEnrichmentEnabled;
  return (
    <>
      {enrichment ? (
        <BackLink href={ENRICHMENT_RETURN_PATH} label="Back to Sign in and sources" />
      ) : (
        <BackLink href="/signin" label="Back to About you" />
      )}
      <Steps current={enrichment ? 3 : 2} flow={enrichment ? "enrichment" : "classic"} />
      <BadgeForm enrichment={enrichment} />
    </>
  );
}

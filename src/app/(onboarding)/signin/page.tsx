import type { Metadata } from "next";
import { connection } from "next/server";
import { BackLink } from "@/components/ui/back-link";
import { config } from "@/server/config";
import { Steps } from "../_components/steps";
import { continueWithGitHub } from "./actions";
import { DetailsForm } from "./details-form";
import { StartForm } from "./start-form";

export const metadata: Metadata = { title: "About you" };

// Rendered per request, so the profile enrichment switch is read at run time rather than built in.
export const instant = false;

/**
 * Step 1: name, workplace, country, and where Lanyard should look. With profile
 * enrichment on, page two signs in and confirms sources; otherwise this signs in
 * with GitHub as before.
 */
export default async function SignInPage() {
  await connection();
  const enrichment = config.profileEnrichmentEnabled;
  return (
    <>
      <div className="mx-auto flex max-w-xl flex-col">
        <BackLink href="/" label="Back to home" />
        <Steps current={1} flow={enrichment ? "enrichment" : "classic"} />
      </div>
      {enrichment ? <DetailsForm /> : <StartForm action={continueWithGitHub} demo={config.fakeApi} />}
    </>
  );
}

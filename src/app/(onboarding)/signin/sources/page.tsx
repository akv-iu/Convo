import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { BackLink } from "@/components/ui/back-link";
import { config } from "@/server/config";
import { readReason } from "../../_components/reasons";
import { Steps } from "../../_components/steps";
import { signInWithGitHub, signInWithGoogle } from "./actions";
import { SourcesForm } from "./sources-form";

// Neutral, because a switched-off feature still serves this title with the not-found page.
export const metadata: Metadata = { title: "Sign in" };

// Rendered per request, so the switch is read at run time. Switched off, this shows the not-found
// page (noindex); the layout has already streamed, so the status is 200. A real 404 would need a Proxy.
export const instant = false;

/**
 * Profile enrichment's page two (ENRICHMENT_RETURN_PATH): sign-in, connections
 * and source choices. Sign-in and GitHub connection return here, with ?reason=
 * on cancel or refusal; only known reason codes are shown.
 */
export default async function SourcesPage({ searchParams }: { searchParams: Promise<{ reason?: string | string[] }> }) {
  await connection();
  if (!config.profileEnrichmentEnabled) notFound();
  const reason = readReason((await searchParams).reason);
  return (
    <>
      <div className="mx-auto flex max-w-xl flex-col">
        <BackLink href="/signin" label="Back to About you" />
        <Steps current={2} flow="enrichment" />
      </div>
      <SourcesForm reason={reason} signInWithGoogle={signInWithGoogle} signInWithGitHub={signInWithGitHub} />
    </>
  );
}

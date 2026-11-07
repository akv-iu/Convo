import type { Metadata } from "next";
import { BackLink } from "@/components/ui/back-link";
import { Steps } from "../../_components/steps";
import { FreeTimeForm } from "./free-time-form";

export const metadata: Metadata = { title: "Free time" };

/** Step 3: pick the half-hour blocks you're free to meet. */
export default function FreeTimePage() {
  return (
    <>
      <BackLink href="/onboarding" label="Back to Your badge" />
      <Steps current={3} />
      <FreeTimeForm />
    </>
  );
}

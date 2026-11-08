import type { Metadata } from "next";
import { BackLink } from "@/components/ui/back-link";
import { Steps } from "../_components/steps";
import { BadgeForm } from "./badge-form";

export const metadata: Metadata = { title: "Your badge" };

/** Step 2: the badge card, hiring, colour and what to show. Saves steps 1 and 2 together. */
export default function BadgePage() {
  return (
    <>
      <BackLink href="/signin" label="Back to About you" />
      <Steps current={2} />
      <BadgeForm />
    </>
  );
}

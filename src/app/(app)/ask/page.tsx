import type { Metadata } from "next";
import { BackLink } from "@/components/ui/back-link";
import { AskForm } from "./ask-form";
import { LookingForYou } from "./looking-for-you";

export const metadata: Metadata = { title: "Ask" };

/** A1 steps 5 and 6: who's looking for you, then the ask box and refine screen. Onboarding ends here. */
export default function AskPage() {
  return (
    <>
      <div className="mx-auto flex max-w-2xl flex-col">
        <BackLink href="/onboarding/profile" label="Back to Your details" />
      </div>
      <LookingForYou />
      <AskForm />
    </>
  );
}

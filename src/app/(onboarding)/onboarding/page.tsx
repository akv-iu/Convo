import type { Metadata } from "next";
import { Steps } from "../_components/steps";

export const metadata: Metadata = { title: "About you" };

/** Placeholder until A1 step 2 (onboarding questions) lands. */
export default function OnboardingPage() {
  return (
    <>
      <Steps current={2} />
      <h1 className="text-3xl font-semibold tracking-tight">About you</h1>
      <p className="mt-3 text-lg text-muted">
        You&apos;re signed in. The questions about your country, workplace and hiring come next.
      </p>
    </>
  );
}

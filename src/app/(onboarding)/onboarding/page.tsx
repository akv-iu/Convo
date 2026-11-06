import type { Metadata } from "next";
import { Steps } from "../_components/steps";

export const metadata: Metadata = { title: "About you" };

/**
 * Placeholder landing spot for A1 step 1's redirect. The questions
 * themselves are A1 step 2 and replace this page.
 */
export default function OnboardingPage() {
  return (
    <>
      <Steps current={2} />
      <h1 className="text-[2.6rem] font-extrabold leading-[1.02] tracking-[-0.03em] [font-stretch:85%] sm:text-6xl">
        About you
      </h1>
      <p className="mt-3 max-w-md text-lg text-muted">You&apos;re signed in. Three quick questions come next.</p>
    </>
  );
}

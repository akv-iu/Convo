import type { Metadata } from "next";
import { Steps } from "../../_components/steps";

export const metadata: Metadata = { title: "Your profile" };

/**
 * Placeholder landing spot for A1 step 2's redirect. The profile card
 * itself is A1 step 3 and replaces this page.
 */
export default function ProfilePlaceholderPage() {
  return (
    <>
      <Steps current={3} />
      <h1 className="text-[2.6rem] font-extrabold leading-[1.02] tracking-[-0.03em] [font-stretch:85%] sm:text-6xl">
        Your profile
      </h1>
      <p className="mt-3 max-w-md text-lg text-muted">Saved. Your profile card comes next.</p>
    </>
  );
}

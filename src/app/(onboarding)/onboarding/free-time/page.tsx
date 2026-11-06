import type { Metadata } from "next";
import { Steps } from "../../_components/steps";

export const metadata: Metadata = { title: "Free time" };

/**
 * Placeholder landing spot for A1 step 3's redirect. The free-time grid
 * itself is A1 step 4 and replaces this page.
 */
export default function FreeTimePlaceholderPage() {
  return (
    <>
      <Steps current={4} />
      <h1 className="text-[2.6rem] font-extrabold leading-[1.02] tracking-[-0.03em] [font-stretch:85%] sm:text-6xl">
        Free time
      </h1>
      <p className="mt-3 max-w-md text-lg text-muted">Saved. Picking your free times comes next.</p>
    </>
  );
}

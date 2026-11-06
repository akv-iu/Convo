import type { Metadata } from "next";

export const metadata: Metadata = { title: "Ask" };

/**
 * Placeholder landing spot for the end of onboarding (A1 step 4's Finish).
 * The ask box and refine screen are A1 step 5 and replace this page.
 */
export default function AskPlaceholderPage() {
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-12">
      <h1 className="text-4xl font-semibold tracking-tight">You&apos;re set up</h1>
      <p className="mt-3 text-lg text-muted">Asking your first question comes next.</p>
    </main>
  );
}

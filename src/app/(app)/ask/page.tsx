import type { Metadata } from "next";
import { AskForm } from "./ask-form";

export const metadata: Metadata = { title: "Ask" };

/** A1 step 5: the ask box and refine screen. The end of onboarding lands here. */
export default function AskPage() {
  return <AskForm />;
}

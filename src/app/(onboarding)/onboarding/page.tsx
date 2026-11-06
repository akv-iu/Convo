import type { Metadata } from "next";
import { Steps } from "../_components/steps";
import { AboutYouForm } from "./about-you-form";

export const metadata: Metadata = { title: "About you" };

/** A1 step 2: workplace, country and hiring, saved as the profile's filters. */
export default function AboutYouPage() {
  return (
    <>
      <Steps current={2} />
      <AboutYouForm />
    </>
  );
}

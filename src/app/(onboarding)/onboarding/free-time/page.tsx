import type { Metadata } from "next";
import { Steps } from "../../_components/steps";
import { FreeTimeForm } from "./free-time-form";

export const metadata: Metadata = { title: "Free time" };

/** A1 step 4: pick the half-hour blocks you're free to meet. */
export default function FreeTimePage() {
  return (
    <>
      <Steps current={4} />
      <FreeTimeForm />
    </>
  );
}

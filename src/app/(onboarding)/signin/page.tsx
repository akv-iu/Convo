import type { Metadata } from "next";
import { config } from "@/server/config";
import { Steps } from "../_components/steps";
import { continueWithGitHub } from "./actions";
import { StartForm } from "./start-form";

export const metadata: Metadata = { title: "About you" };

/** Step 1: name, workplace, country, and where Convo should look. No badge yet. */
export default function SignInPage() {
  return (
    <>
      <div className="mx-auto max-w-xl">
        <Steps current={1} />
      </div>
      <StartForm action={continueWithGitHub} demo={config.fakeApi} />
    </>
  );
}

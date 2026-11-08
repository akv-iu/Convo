import type { Metadata } from "next";
import { BackLink } from "@/components/ui/back-link";
import { config } from "@/server/config";
import { Steps } from "../_components/steps";
import { continueWithGitHub } from "./actions";
import { StartForm } from "./start-form";

export const metadata: Metadata = { title: "About you" };

/** Step 1: name, workplace, country, and where Lanyard should look. No badge yet. */
export default function SignInPage() {
  return (
    <>
      <div className="mx-auto flex max-w-xl flex-col">
        <BackLink href="/" label="Back to home" />
        <Steps current={1} />
      </div>
      <StartForm action={continueWithGitHub} demo={config.fakeApi} />
    </>
  );
}

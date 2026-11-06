import type { Metadata } from "next";
import { Button } from "@/components/ui/button";
import { config } from "@/server/config";
import { Steps } from "../_components/steps";
import { consentSources } from "../consent";
import { continueWithGitHub } from "./actions";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    <>
      <Steps current={1} />
      <h1 className="text-3xl font-semibold tracking-tight">Sign in to Convo</h1>
      <p className="mt-3 text-lg text-muted">
        We build your profile from your public GitHub data, so you edit it instead of writing it. Choose what we may
        use.
      </p>

      <form action={continueWithGitHub} className="mt-8 flex flex-col gap-6">
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-3 font-medium">What Convo may import from GitHub</legend>

          <div className="rounded-lg border border-border bg-surface p-4">
            <p className="font-medium">Your name, username and avatar</p>
            <p className="mt-1 text-sm text-muted">Always imported, so people can recognise you.</p>
          </div>

          {consentSources.map((source) => (
            <label
              key={source.id}
              className="flex cursor-pointer gap-3 rounded-lg border border-border p-4 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent"
            >
              <input
                type="checkbox"
                name={source.id}
                defaultChecked
                aria-describedby={`${source.id}-hint`}
                className="mt-1 size-5 shrink-0 accent-accent focus-visible:outline-none"
              />
              <span>
                <span className="block font-medium">{source.label}</span>
                <span id={`${source.id}-hint`} className="mt-1 block text-sm text-muted">
                  {source.hint}
                </span>
              </span>
            </label>
          ))}
        </fieldset>

        <p className="text-sm text-muted">
          We only import public data and never post anything to GitHub. Unticking a source skips it when you sign in;
          it doesn&apos;t remove anything already on your profile.
        </p>

        <Button type="submit" className="w-full sm:w-auto sm:self-start">
          Continue with GitHub
        </Button>

        {config.fakeApi && (
          <p className="rounded-lg border border-dashed border-border p-3 text-sm text-muted">
            The fake API is on, so this skips GitHub and signs you in as demo user A.
          </p>
        )}
      </form>
    </>
  );
}

import type { Metadata } from "next";
import { Button } from "@/components/ui/button";
import { config } from "@/server/config";
import { Steps } from "../_components/steps";
import { consentSources } from "../consent";
import { continueWithGitHub } from "./actions";
import { BadgePreview } from "./badge-preview";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    <>
      <Steps current={1} />

      <form
        action={continueWithGitHub}
        className="group/consent grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:gap-16"
      >
        <div className="flex flex-col">
          <h1 className="text-[2.6rem] font-extrabold leading-[1.02] tracking-[-0.03em] [font-stretch:85%] sm:text-6xl">
            Make your badge
          </h1>
          <p className="mt-3 max-w-md text-lg text-muted">
            Convo fills it in from your public GitHub, so you only tweak it. Pick what goes on.
          </p>

          <fieldset className="mt-8">
            <legend className="mb-3 text-base font-semibold">What goes on your badge</legend>
            <div className="flex flex-col gap-2.5">
              {consentSources.map((source) => (
                <label
                  key={source.id}
                  className="group/tile flex min-h-16 cursor-pointer items-center gap-4 rounded-xl border-2 border-border bg-surface px-4 py-3 transition-colors has-[:checked]:border-accent has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent motion-reduce:transition-none"
                >
                  <span className="flex-1">
                    <span className="block text-lg font-semibold leading-snug">{source.label}</span>
                    <span id={`${source.id}-hint`} className="block text-sm text-muted">
                      {source.hint}
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    name={source.id}
                    defaultChecked
                    aria-describedby={`${source.id}-hint`}
                    className="peer sr-only"
                  />
                  {/* switch */}
                  <span
                    aria-hidden="true"
                    className="relative h-7 w-12 shrink-0 rounded-full bg-border transition-colors peer-checked:bg-accent motion-reduce:transition-none after:absolute after:left-1 after:top-1 after:size-5 after:rounded-full after:bg-surface after:shadow after:transition-transform peer-checked:after:translate-x-5 motion-reduce:after:transition-none"
                  />
                </label>
              ))}
            </div>
            <p className="mt-3 text-sm text-muted">Your name, username and avatar are always on it.</p>
          </fieldset>

          {/* Phone and tablet: below the switches, so flipping one changes what's under your thumb, not above it. */}
          <div className="mt-8 lg:hidden">
            <BadgePreview />
          </div>

          <div className="sticky bottom-0 -mx-4 mt-8 bg-background/95 px-4 pb-4 pt-3 backdrop-blur sm:static sm:mx-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
            <Button type="submit" className="w-full text-lg sm:w-auto sm:px-8">
              Continue with GitHub
            </Button>
          </div>

          <p className="mt-4 max-w-md text-sm text-muted">
            Public data only, and nothing is posted to GitHub. Turning something off skips it when you sign in; it
            won&apos;t remove anything already on your profile.
          </p>

          {config.fakeApi && (
            <p className="mt-4 max-w-md rounded-lg border border-dashed border-border px-3 py-2 text-sm text-muted">
              The fake API is on, so this skips GitHub and signs you in as demo user A.
            </p>
          )}
        </div>

        <div className="hidden lg:block">
          <BadgePreview />
        </div>
      </form>
    </>
  );
}

"use client";

/**
 * Step 2, "Your badge": the badge card (name, workplace and country from
 * step 1), the hiring question, the badge colour, and what to show on the
 * card. Continue saves steps 1 and 2 together with PUT /api/me: name plus a
 * complete filters object, as B2's API requires (db/Profile-API.md).
 *
 * Where step 1's answers come from:
 * - the draft step 1 left in this tab (normal path);
 * - otherwise the saved profile from GET /api/me (returning user, other
 *   device). A 409 there means first-time onboarding isn't done, so the
 *   user is sent back to step 1. Other failures are errors, not "empty".
 * Nothing is shown until loading finishes, so a late load can't overwrite
 * what the user has already chosen.
 *
 * The save also carries the workplace label, badge colour and the
 * complete visibility object (db/Frontend-Support.md). The saved profile's
 * colour wins over the convo_badge cookie, which is only a preview for
 * the first paint. Visibility affects other people's cards only.
 */
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import type { Person, ProfileVisibility } from "@/contracts/types";
import { Badge, BadgeChip } from "../_components/badge";
import { DEFAULT_COLOUR, isBadgeColour, readBadgePrefs, showSavedColour, writeBadgePrefs, type BadgeColour } from "../_components/badge-prefs";
import { colourFollowsPicker, ColourPicker } from "../_components/colour-picker";
import { clearDraft, readDraft } from "../_components/draft";
import {
  aboutFromProfile,
  missingAnswers,
  missingMessage,
  saveErrorMessage,
  SHOW_ALL,
  toProfileBody,
  workplaceLabel,
  type AboutYou,
} from "./answers";
import { countryName } from "@/components/ui/countries";

export const NEXT_STEP = "/onboarding/free-time";

const headingClass =
  "text-[2.6rem] font-extrabold leading-[1.02] tracking-[-0.03em] [font-stretch:85%] sm:text-6xl";
const legendClass = "mb-3 text-xl font-bold leading-snug tracking-tight";
const errorClass = "text-sm font-medium text-[var(--danger)]";

type Load =
  | { state: "loading" }
  | { state: "ready"; about: AboutYou; handle: string | null; hiring: boolean | null }
  | { state: "start" } // no step 1 answers anywhere: begin at step 1
  | { state: "failed"; status: number };

const sections = [
  { id: "country", label: "Country" },
  { id: "workplace", label: "Workplace" },
  { id: "hiring", label: "Hiring status" },
] as const;


export function BadgeForm() {
  const router = useRouter();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [hiring, setHiring] = useState<boolean | null>(null);
  const [colour, setColour] = useState<BadgeColour>(DEFAULT_COLOUR);
  const [visibility, setVisibility] = useState<ProfileVisibility>(SHOW_ALL);
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const hiringRef = useRef<HTMLFieldSetElement>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const draft = readDraft();
      let profile: Person | null = null;
      let status = 0;
      try {
        const res = await fetch("/api/me", { cache: "no-store" });
        status = res.status;
        if (res.ok) profile = (await res.json()) as Person;
      } catch {
        status = 0;
      }
      if (!live) return;
      // The saved profile's colour is the truth; before there is one, the cookie preview is all we have.
      setColour(profile ? showSavedColour(profile.badgeColour) : readBadgePrefs().colour);
      setVisibility(profile?.visibility ?? SHOW_ALL);

      if (draft) {
        // Step 1 just ran in this tab; the profile only adds the GitHub handle and any saved hiring answer.
        setHiring(profile?.filters.hiring ?? null);
        setLoad({ state: "ready", about: draft, handle: profile?.githubLogin ?? null, hiring: profile?.filters.hiring ?? null });
      } else if (profile) {
        setHiring(profile.filters.hiring);
        setLoad({ state: "ready", about: aboutFromProfile(profile), handle: profile.githubLogin, hiring: profile.filters.hiring });
      } else if (status === 409) {
        setLoad({ state: "start" });
      } else {
        setLoad({ state: "failed", status });
      }
    })();
    return () => {
      live = false;
    };
  }, [attempt]);

  if (load.state === "loading") {
    return (
      <div aria-busy="true">
        <h1 className={headingClass}>Your badge</h1>
        <p role="status" className="mt-3 text-lg text-muted">
          Loading…
        </p>
      </div>
    );
  }

  if (load.state === "start" || load.state === "failed") {
    const expired = load.state === "failed" && (load.status === 401 || load.status === 404);
    return (
      <div className="max-w-md">
        <h1 className={headingClass}>Your badge</h1>
        <p role="alert" className="mt-4 text-lg">
          {load.state === "start"
            ? "Start with your name, workplace and country."
            : expired
              ? "Your sign-in has expired."
              : "Your details didn't load. Try again in a moment."}
        </p>
        <div className="mt-6">
          {load.state === "start" ? (
            <Button href="/signin">Go to About you</Button>
          ) : expired ? (
            <Button href="/signin">Sign in again</Button>
          ) : (
            <Button onClick={() => (setLoad({ state: "loading" }), setAttempt((n) => n + 1))}>Try again</Button>
          )}
        </div>
      </div>
    );
  }

  const { about, handle } = load;
  const answers = { ...about, hiring };
  const missing = missingAnswers(answers);
  const step1Missing = missing.filter((m) => m !== "hiring");
  const hiringProblem = tried && missing.includes("hiring");

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setTried(true);
    setSaveError(null);
    if (step1Missing.length) return; // shown below with a link back to step 1
    if (missing.includes("hiring")) {
      hiringRef.current?.querySelector<HTMLElement>("input")?.focus();
      return;
    }
    const picked = new FormData(e.currentTarget).get("colour");
    const badgeColour = isBadgeColour(picked) ? picked : colour;
    setSaving(true);
    try {
      const res = await fetch("/api/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toProfileBody(answers, badgeColour, visibility)),
      });
      if (!res.ok) {
        setSaveError(saveErrorMessage(res.status, await res.json().catch(() => null)));
        return;
      }
      const saved = (await res.json().catch(() => null)) as Person | null;
      writeBadgePrefs({ colour: saved?.badgeColour ?? badgeColour });
      clearDraft();
      router.push(NEXT_STEP);
    } catch {
      setSaveError(saveErrorMessage(0, null));
    } finally {
      setSaving(false);
    }
  }

  function toggleSection(id: (typeof sections)[number]["id"]) {
    setVisibility((cur) => ({ ...cur, [id]: !cur[id] }));
  }

  /**
   * A line on the badge people can hide: tap it (pointer) to hide or show
   * it. The badge is decorative for screen readers, so the labelled
   * switches beside it do the same for keyboard and screen-reader users.
   */
  const tappable = (id: (typeof sections)[number]["id"]) =>
    `cursor-pointer rounded-md -mx-1 px-1 hover:bg-accent/10 ${visibility[id] ? "" : "opacity-40 line-through"}`;

  const badge = (
    <Badge
      name={about.name}
      handle={handle ?? "your-github"}
      label={
        <span role="presentation" onClick={() => toggleSection("country")} className={tappable("country")}>
          {countryName(about.country)}
        </span>
      }
    >
      <span role="presentation" onClick={() => toggleSection("workplace")} className={`mt-4 block ${tappable("workplace")}`}>
        <span className="block text-xs text-muted">Works at</span>
        <span className="block font-semibold leading-snug break-words">{workplaceLabel(about.workplace)}</span>
      </span>
      <span role="presentation" onClick={() => toggleSection("hiring")} className={`mt-3 flex w-fit flex-wrap gap-1.5 ${tappable("hiring")}`}>
        {hiring === null ? (
          <BadgeChip className="w-20" />
        ) : (
          <BadgeChip className={hiring ? "bg-accent text-on-accent" : "bg-[var(--skeleton)]"}>
            {hiring ? "Hiring" : "Not hiring"}
          </BadgeChip>
        )}
      </span>
    </Badge>
  );

  return (
    <form
      onSubmit={submit}
      noValidate
      className={`grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:gap-x-16 ${colourFollowsPicker}`}
    >
      <div className="lg:col-start-1 lg:row-start-1">
        <h1 className={headingClass}>Your badge</h1>
        <p className="mt-3 max-w-md text-lg text-muted">Three quick answers so you make the right connections.</p>
      </div>

      {/* The badge with everything that changes how it looks right beside it (rendered once: on a phone it
          follows the heading, on a laptop it's the right-hand column). */}
      <section aria-label="Your badge's look" className="lg:col-start-2 lg:row-span-2 lg:row-start-1">
        <div className="mx-auto flex w-full max-w-[19rem] flex-col gap-6 lg:sticky lg:top-6">
          {badge}
          <p className="text-center text-sm text-muted" aria-hidden="true">
            Tap a line on your badge to hide it from other people.
          </p>
          <ColourPicker defaultColour={colour} />
          <fieldset className="border-0 p-0" aria-describedby="visibility-note">
            <legend className="mb-1 text-base font-semibold">Show on your badge</legend>
            <p id="visibility-note" className="mb-2 text-sm text-muted">
              Your name and GitHub are always shown.
            </p>
            <div className="flex flex-col gap-1.5">
              {sections.map((v) => (
                <label
                  key={v.id}
                  className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border-2 border-border bg-surface px-3 py-1.5 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent"
                >
                  <span className="flex-1 font-semibold">{v.label}</span>
                  <span className="text-sm text-muted" aria-hidden="true">
                    {visibility[v.id] ? "Shown" : "Hidden"}
                  </span>
                  <input
                    type="checkbox"
                    role="switch"
                    checked={visibility[v.id]}
                    onChange={(e) => setVisibility((cur) => ({ ...cur, [v.id]: e.target.checked }))}
                    className="peer sr-only"
                  />
                  <span
                    aria-hidden="true"
                    className="relative h-7 w-12 shrink-0 rounded-full bg-[var(--skeleton)] transition-colors peer-checked:bg-accent after:absolute after:left-1 after:top-1 after:size-5 after:rounded-full after:bg-surface after:shadow after:transition-[left] peer-checked:after:left-6 motion-reduce:transition-none motion-reduce:after:transition-none"
                  />
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      </section>

      <div className="flex flex-col lg:col-start-1 lg:row-start-2">
        <fieldset ref={hiringRef} className="flex flex-col gap-3 border-0 p-0" aria-describedby={hiringProblem ? "hiring-problem" : undefined}>
          <legend className={legendClass}>Are you hiring?</legend>
          <div className="grid grid-cols-2 gap-2.5">
            {[
              { value: true, label: "Yes, I'm hiring", hint: "People looking for jobs can find you." },
              { value: false, label: "Not right now", hint: "Career asks won't be sent to you." },
            ].map((o) => (
              <label
                key={String(o.value)}
                className="flex min-h-24 cursor-pointer flex-col justify-center rounded-xl border-2 border-border bg-surface px-4 py-3 transition-colors has-[:checked]:border-accent has-[:checked]:bg-accent/10 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent motion-reduce:transition-none"
              >
                <input type="radio" name="hiring" checked={hiring === o.value} onChange={() => setHiring(o.value)} className="sr-only" />
                <span className="text-lg font-semibold leading-snug">{o.label}</span>
                <span className="text-sm text-muted">{o.hint}</span>
              </label>
            ))}
          </div>
          {hiringProblem && (
            <p id="hiring-problem" className={errorClass}>
              {missingMessage.hiring}
            </p>
          )}
        </fieldset>

        <div className="sticky bottom-0 -mx-4 mt-8 bg-background/95 px-4 pb-4 pt-3 backdrop-blur sm:static sm:mx-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
          {tried && step1Missing.length > 0 && (
            <p role="alert" className={`mb-3 ${errorClass}`}>
              {missingMessage[step1Missing[0]]}{" "}
              <a href="/signin" className="underline underline-offset-4">
                Go back to About you
              </a>
            </p>
          )}
          {saveError && (
            <p role="alert" className={`mb-3 ${errorClass}`}>
              {saveError}
              {saveError.startsWith("Your sign-in has expired") && (
                <>
                  {" "}
                  <a href="/signin" className="underline underline-offset-4">
                    Sign in again
                  </a>
                </>
              )}
            </p>
          )}
          <Button type="submit" disabled={saving} className="w-full text-lg sm:w-auto sm:px-8">
            {saving ? "Saving…" : "Continue"}
          </Button>
        </div>
      </div>
    </form>
  );
}

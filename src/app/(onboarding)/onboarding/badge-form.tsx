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
import { Switch } from "@/components/ui/switch";
import { Avatar, avatars } from "@/components/ui/avatars";
import { badgeColours, colourHex } from "@/components/ui/badge-colours";
import type { AvatarId, Person, ProfileVisibility } from "@/contracts/types";
import { Badge } from "../_components/badge";
import { BadgeCountry, BadgeLines } from "../_components/badge-lines";
import { DEFAULT_COLOUR, isBadgeColour, readBadgePrefs, showSavedColour, writeBadgePrefs, type BadgeColour } from "../_components/badge-prefs";
import { colourFollowsPicker, ColourPicker } from "../_components/colour-picker";
import { clearDraft, readDraft } from "../_components/draft";
import {
  aboutFromProfile,
  missingAnswers,
  missingMessage,
  saveErrorMessage,
  SHOW_ALL,
  VISIBILITY_SECTIONS,
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
  // handle: undefined until a profile says (the badge shows a placeholder), null when they have no GitHub.
  | { state: "ready"; about: AboutYou; handle: string | null | undefined; hiring: boolean | null }
  | { state: "start" } // no step 1 answers anywhere: begin at step 1
  | { state: "failed"; status: number };

const sections = VISIBILITY_SECTIONS;


export function BadgeForm() {
  const router = useRouter();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [hiring, setHiring] = useState<boolean | null>(null);
  const [colour, setColour] = useState<BadgeColour>(DEFAULT_COLOUR);
  const [visibility, setVisibility] = useState<ProfileVisibility>(SHOW_ALL);
  /** The chosen picture (null: initials), saved with Continue like the colour. */
  const [avatar, setAvatar] = useState<AvatarId | null>(null);
  /** The picture circle's own colour; null follows the badge colour. Saved with Continue. */
  const [avatarColour, setAvatarColour] = useState<BadgeColour | null>(null);
  const pictureHex = avatarColour ? colourHex(avatarColour) : undefined;
  const [pickerOpen, setPickerOpen] = useState(false);
  /** Which the colour swatches change: the badge stripe or the picture circle. */
  const [colourFor, setColourFor] = useState<"badge" | "picture">("badge");
  const plusRef = useRef<HTMLButtonElement>(null);
  const pickerRef = useRef<HTMLFieldSetElement>(null);
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
      setAvatar(profile?.avatar ?? null);
      setAvatarColour(profile?.avatarColour ?? null);

      if (draft) {
        // Step 1 just ran in this tab; the profile only adds the GitHub handle and any saved hiring answer.
        setHiring(profile?.filters.hiring ?? null);
        setLoad({ state: "ready", about: draft, handle: profile?.githubLogin, hiring: profile?.filters.hiring ?? null });
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
        body: JSON.stringify(toProfileBody(answers, badgeColour, visibility, avatar, avatarColour)),
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


  function closePicker() {
    setPickerOpen(false);
    plusRef.current?.focus();
  }

  const badge = (
    <Badge
      name={about.name}
      handle={handle}
      avatar={avatar}
      avatarColour={pictureHex}
      avatarControl={
        <button
          ref={plusRef}
          type="button"
          aria-label="Choose a picture"
          aria-expanded={pickerOpen}
          aria-controls="avatar-picker"
          onClick={() => {
            setPickerOpen((open) => !open);
            setTimeout(() => pickerRef.current?.querySelector<HTMLInputElement>("input:checked")?.focus(), 0);
          }}
          className="absolute -bottom-1 -right-1 flex size-7 items-center justify-center rounded-full bg-accent text-lg font-bold leading-none text-on-accent shadow ring-2 ring-surface hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <span aria-hidden="true">+</span>
        </button>
      }
      label={<BadgeCountry country={countryName(about.country)} shown={visibility.country} onHide={toggleSection} />}
    >
      <BadgeLines workplace={workplaceLabel(about.workplace)} hiring={hiring} visibility={visibility} onHide={toggleSection} />
    </Badge>
  );

  return (
    <form onSubmit={submit} noValidate className={`flex flex-col ${colourFollowsPicker}`}>
      <h1 className={headingClass}>Your badge</h1>
      <p className="mt-3 max-w-md text-lg text-muted">Three quick answers so you make the right connections.</p>

      <fieldset
        ref={hiringRef}
        className="mt-8 flex max-w-2xl flex-col gap-3 border-0 p-0"
        aria-describedby={hiringProblem ? "hiring-problem" : undefined}
      >
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

      {/* The badge, with what changes it right beside it (rendered once). */}
      <section
        aria-label="Your badge's look"
        className="mt-10 grid items-start gap-8 sm:grid-cols-[minmax(0,19rem)_minmax(0,1fr)] lg:gap-14"
      >
        <div className="w-full sm:col-start-1 sm:row-start-1">{badge}</div>
        {/* Under the badge: the picture picker, when open. */}
        <div className="flex w-full flex-col items-center gap-6 empty:hidden sm:col-start-1 sm:row-start-2">
          {pickerOpen && (
            <fieldset
              id="avatar-picker"
              ref={pickerRef}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  closePicker();
                }
              }}
              className="w-full rounded-2xl border-2 border-border bg-surface p-4"
            >
              <legend className="float-left mb-3 w-full text-base font-semibold">Your picture</legend>
              <div className="clear-both grid grid-cols-5 gap-2 sm:grid-cols-4">
                {[{ id: null, name: "Initials" }, ...avatars].map((a) => (
                  <label key={a.id ?? "initials"} title={a.name} className="relative flex cursor-pointer justify-center">
                    <input
                      type="radio"
                      name="avatar"
                      checked={avatar === a.id}
                      onChange={() => setAvatar(a.id)}
                      className="peer sr-only"
                    />
                    <Avatar
                      avatar={a.id}
                      name={about.name}
                      colour={pictureHex}
                      className="size-11 ring-1 ring-black/10 peer-checked:ring-4 peer-checked:ring-foreground peer-checked:ring-offset-2 peer-checked:ring-offset-surface peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-accent"
                    />
                    <span className="sr-only">{a.name}</span>
                  </label>
                ))}
              </div>
              <div className="mt-3 flex justify-end">
                <Button type="button" variant="secondary" onClick={closePicker}>
                  Done
                </Button>
              </div>
            </fieldset>
          )}
        </div>
        {/*
          Beside the badge: one panel, what to show and then the colours, the same height as the badge
          card so their tops and bottoms line up. From 1024 px the badge hangs from a strap (lg:mt-16),
          so the same margin here starts the panel level with the card.
        */}
        <div className="flex w-full max-w-sm flex-col justify-between gap-2 rounded-2xl border-2 border-border bg-surface px-4 py-2.5 sm:col-start-2 sm:row-start-1 sm:self-stretch lg:mt-16">
          <fieldset className="border-0 p-0">
            <legend className="sr-only">Show on your badge</legend>
            <div className="flex flex-col divide-y-2 divide-border">
              {sections.map((v) => (
                <Switch
                  boxed={false}
                  key={v.id}
                  label={v.label}
                  aside={visibility[v.id] ? "Shown" : "Hidden"}
                  checked={visibility[v.id]}
                  onChange={(on) => setVisibility((cur) => ({ ...cur, [v.id]: on }))}
                />
              ))}
            </div>
          </fieldset>
          {/*
            One colour panel for both: pick Badge or Picture, then a colour. Both groups stay in the
            form (the badge's colours the stripe through CSS); only the chosen one is in view.
          */}
          <div className="border-t-2 border-border pt-3">
            <h2 className="sr-only">Colours</h2>
            {/* The Badge / Picture choice and its swatches on one row, wrapping on narrow screens. */}
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
              <div role="group" aria-label="Colour for" className="flex rounded-full border-2 border-border p-0.5">
                {(["badge", "picture"] as const).map((target) => (
                  <button
                    key={target}
                    type="button"
                    aria-pressed={colourFor === target}
                    onClick={() => setColourFor(target)}
                    className="flex h-8 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold transition-colors aria-pressed:bg-foreground aria-pressed:text-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none"
                  >
                    <span
                      aria-hidden="true"
                      className="size-3 rounded-full ring-1 ring-black/15"
                      style={{ backgroundColor: target === "badge" ? "var(--badge)" : (pictureHex ?? "var(--badge)") }}
                    />
                    {target === "badge" ? "Badge" : "Picture"}
                  </button>
                ))}
              </div>
            <div>
              <ColourPicker defaultColour={colour} quiet hidden={colourFor !== "badge"} />
              <fieldset hidden={colourFor !== "picture"}>
                <legend className="sr-only">Picture colour</legend>
                <div className="flex flex-wrap items-center gap-2">
                  {badgeColours.map((c) => (
                    <label key={c.id} title={c.name} className="relative cursor-pointer">
                      <input
                        type="radio"
                        name="avatarColour"
                        value={c.id}
                        checked={avatarColour === c.id}
                        onChange={() => setAvatarColour(c.id)}
                        className="peer sr-only"
                      />
                      <span aria-hidden="true" style={{ backgroundColor: c.hex }} className="block size-7 rounded-full ring-1 ring-black/10 transition-shadow peer-checked:ring-2 peer-checked:ring-foreground peer-checked:ring-offset-2 peer-checked:ring-offset-surface peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent motion-reduce:transition-none" />
                      <span className="sr-only">{c.name}</span>
                    </label>
                  ))}
                  {/* Following the badge is a worded choice, so it can't be mistaken for a sixth colour. */}
                  <label className="cursor-pointer">
                    <input
                      type="radio"
                      name="avatarColour"
                      value=""
                      checked={avatarColour === null}
                      onChange={() => setAvatarColour(null)}
                      className="peer sr-only"
                    />
                    <span className="flex h-8 items-center rounded-full border-2 border-border px-3 text-xs font-semibold transition-colors peer-checked:border-foreground peer-checked:bg-foreground peer-checked:text-background peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-accent motion-reduce:transition-none">
                      Same as badge
                    </span>
                  </label>
                </div>
              </fieldset>
            </div>
            </div>
          </div>
        </div>
      </section>

      <div className="sticky bottom-0 -mx-4 mt-10 bg-background/95 px-4 pb-4 pt-3 text-center backdrop-blur sm:static sm:mx-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
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
    </form>
  );
}

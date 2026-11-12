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
import type { AvatarId, Person, ProfileVisibility } from "@/contracts/types";
import { Badge } from "../_components/badge";
import { BadgeCountry, BadgeLines } from "../_components/badge-lines";
import { DEFAULT_COLOUR, isBadgeColour, readBadgePrefs, showSavedColour, writeBadgePrefs, type BadgeColour } from "../_components/badge-prefs";
import { colourFollowsPicker, ColourPicker } from "../_components/colour-picker";
import { clearDraft, readDraft } from "../_components/draft";
import { ENRICHMENT_RETURN_PATH } from "@/contracts/enrichment";
import type { RouteResponse } from "@/contracts/routes";
import { enrichmentApi, type Result } from "../signin/sources/api";
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

/**
 * With profile enrichment: step 1's answers from the account's saved identity, the handle from its GitHub
 * connection. The saved profile (colour, picture, visibility, hiring) must load or be confirmed missing (409):
 * starting from defaults after a failed read would save them over the person's choices.
 */
function fromIdentity(owner: Result<RouteResponse<"enrichmentState">>, profile: Person | null, profileStatus: number): Load {
  if (!owner.ok) return { state: "failed", status: owner.status };
  if (!profile && profileStatus !== 409) return { state: "failed", status: profileStatus };
  const { identity, github } = owner.data;
  if (!identity) return { state: "start" };
  return {
    state: "ready",
    about: aboutFromProfile({ name: identity.name, filters: identity, workplaceName: identity.workplaceName }),
    handle: github.connected ? github.login : null,
    hiring: profile?.filters.hiring ?? null,
  };
}


/**
 * With profile enrichment on (`enrichment`), step 1's answers are the identity
 * page two saved for this account, not this tab's draft: after it's saved
 * the account's copy wins, so an older tab can't write its name back. The
 * handle is the connected GitHub, or none. The draft stays, because page two
 * keeps its source choices there for back navigation.
 */
export function BadgeForm({ enrichment = false }: { enrichment?: boolean }) {
  const router = useRouter();
  // Sign-in lives on page two when profile enrichment is on.
  const signIn = enrichment ? ENRICHMENT_RETURN_PATH : "/signin";
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [hiring, setHiring] = useState<boolean | null>(null);
  const [colour, setColour] = useState<BadgeColour>(DEFAULT_COLOUR);
  const [visibility, setVisibility] = useState<ProfileVisibility>(SHOW_ALL);
  /** The chosen picture (null: initials), saved with Continue like the colour. */
  const [avatar, setAvatar] = useState<AvatarId | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const plusRef = useRef<HTMLButtonElement>(null);
  const pickerRef = useRef<HTMLFieldSetElement>(null);
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const hiringRef = useRef<HTMLFieldSetElement>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const draft = enrichment ? null : readDraft();
      let profile: Person | null = null;
      let status = 0;
      const [me, owner] = await Promise.all([
        fetch("/api/me", { cache: "no-store" }).catch(() => null),
        enrichment ? enrichmentApi.state() : null,
      ]);
      status = me?.status ?? 0;
      if (me?.ok) profile = (await me.json().catch(() => null)) as Person | null;
      if (!live) return;
      // The saved profile's colour is the truth; before there is one, the cookie preview is all we have.
      setColour(profile ? showSavedColour(profile.badgeColour) : readBadgePrefs().colour);
      setVisibility(profile?.visibility ?? SHOW_ALL);
      setAvatar(profile?.avatar ?? null);

      if (owner) {
        const next = fromIdentity(owner, profile, status);
        if (next.state === "ready") setHiring(next.hiring);
        setLoad(next);
      } else if (draft) {
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
  }, [attempt, enrichment]);

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
            <Button href={signIn}>Sign in again</Button>
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
        body: JSON.stringify(toProfileBody(answers, badgeColour, visibility, avatar)),
      });
      if (!res.ok) {
        setSaveError(saveErrorMessage(res.status, await res.json().catch(() => null)));
        return;
      }
      const saved = (await res.json().catch(() => null)) as Person | null;
      writeBadgePrefs({ colour: saved?.badgeColour ?? badgeColour });
      if (!enrichment) clearDraft(); // page two still needs it for back navigation
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
        className="mt-10 grid items-start gap-8 sm:grid-cols-[minmax(0,19rem)_minmax(0,1fr)] sm:items-center lg:gap-14"
      >
        <div className="w-full sm:col-start-1 sm:row-start-1">{badge}</div>
        {/* Under the badge: the picture picker (when open) and the colours. */}
        <div className="flex w-full flex-col items-center gap-6 sm:col-start-1 sm:row-start-2">
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
          <ColourPicker defaultColour={colour} centred />
        </div>
        {/*
          Beside the badge, centred on it. From 1024 px the badge hangs from a strap (lg:mt-16), so the
          same margin here centres on the card, not on the strap.
        */}
        <div className="flex flex-col gap-6 sm:col-start-2 sm:row-start-1 sm:self-center lg:mt-16">
          <fieldset className="border-0 p-0" aria-describedby="visibility-note">
            <legend className="mb-1 text-base font-semibold">Show on your badge</legend>
            <p id="visibility-note" className="mb-2 text-sm text-muted">
              Tap a line marked with an eraser on your badge to hide it, or switch it here.{" "}
              {handle === null ? "Your name is always shown." : "Your name and GitHub are always shown."}
            </p>
            <div className="flex max-w-sm flex-col gap-1.5">
              {sections.map((v) => (
                <Switch
                  key={v.id}
                  label={v.label}
                  aside={visibility[v.id] ? "Shown" : "Hidden"}
                  checked={visibility[v.id]}
                  onChange={(on) => setVisibility((cur) => ({ ...cur, [v.id]: on }))}
                />
              ))}
            </div>
          </fieldset>
        </div>
      </section>

      <div className="sticky bottom-0 -mx-4 mt-10 bg-background/95 px-4 pb-4 pt-3 backdrop-blur sm:static sm:mx-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
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
                <a href={signIn} className="underline underline-offset-4">
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

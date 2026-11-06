"use client";

/**
 * A1 step 3: "Here's what we learned about you". Loads the profile with
 * GET /api/me, lets the user edit name, bio, skills (languages) and
 * organisations, and saves only what changed with PUT /api/me (B2's
 * handoff, db/Profile-API.md). The badge updates live; tapping a part of
 * it jumps to that field. The badge colour can be changed here too
 * (frontend-only convo_badge cookie, saved on continue).
 */
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { Person } from "@/contracts/types";
import { Badge, BadgeBar, BadgeChip } from "../../_components/badge";
import { DEFAULT_COLOUR, isBadgeColour, readBadgePrefs, writeBadgePrefs, type BadgeColour } from "../../_components/badge-prefs";
import { colourFollowsPicker, ColourPicker } from "../../_components/colour-picker";
import { saveErrorMessage } from "../answers";
import { ChipEditor } from "./chip-editor";
import { changesFrom, draftFrom, LIMITS, loadProblem, nameProblem, type Draft } from "./edits";

export const NEXT_STEP = "/onboarding/free-time";

const FIELD = {
  name: "profile-name",
  bio: "profile-bio",
  skills: "profile-skill",
  orgs: "profile-org",
} as const;

const inputClass =
  "w-full rounded-xl border-2 border-border bg-surface px-4 text-lg placeholder:text-muted focus-visible:border-accent focus-visible:outline-none aria-invalid:border-[#c2410c]";
const errorClass = "text-sm font-medium text-[#c2410c] dark:text-[#fdba74]";
const headingClass =
  "text-[2.6rem] font-extrabold leading-[1.02] tracking-[-0.03em] [font-stretch:85%] sm:text-6xl";

type Load = { state: "loading" } | { state: "failed"; status: number } | { state: "ready"; person: Person };

/** A badge row that jumps to its field when tapped. */
function BadgeRow({ field, caption, children }: { field: string; caption: string; children: ReactNode }) {
  return (
    <label htmlFor={field} className="-mx-2 mt-3 block cursor-pointer rounded-lg px-2 py-1 hover:bg-accent/10">
      <span className="block text-xs text-muted">{caption}</span>
      {children}
    </label>
  );
}

export function ProfileForm() {
  const router = useRouter();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [original, setOriginal] = useState<Draft | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [colour, setColour] = useState<BadgeColour>(DEFAULT_COLOUR);
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch("/api/me", { cache: "no-store" });
        if (!live) return;
        if (!res.ok) return setLoad({ state: "failed", status: res.status });
        const person = (await res.json()) as Person;
        if (!live) return;
        setColour(readBadgePrefs().colour);
        setOriginal(draftFrom(person));
        setDraft(draftFrom(person));
        setLoad({ state: "ready", person });
      } catch {
        if (live) setLoad({ state: "failed", status: 0 });
      }
    })();
    return () => {
      live = false;
    };
  }, [attempt]);

  if (load.state === "loading" || (load.state === "ready" && (!draft || !original))) {
    return (
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:gap-16" aria-busy="true">
        <div>
          <h1 className={headingClass}>Here&apos;s what we learned</h1>
          <p role="status" className="mt-3 text-lg text-muted">
            Loading your profile…
          </p>
        </div>
        <div className="hidden lg:block motion-safe:animate-pulse">
          <Badge>
            <span className="flex flex-col gap-1.5 pt-4">
              <BadgeBar className="w-full" />
              <BadgeBar className="w-3/5" />
            </span>
          </Badge>
        </div>
      </div>
    );
  }

  if (load.state === "failed") {
    const problem = loadProblem(load.status);
    return (
      <div className="max-w-md">
        <h1 className={headingClass}>Here&apos;s what we learned</h1>
        <p role="alert" className="mt-4 text-lg">
          {problem.message}
        </p>
        <div className="mt-6">
          {problem.action ? (
            <Button href={problem.action.href}>{problem.action.label}</Button>
          ) : (
            <Button onClick={() => (setLoad({ state: "loading" }), setAttempt((n) => n + 1))}>Try again</Button>
          )}
        </div>
      </div>
    );
  }

  // ready
  const person = load.person;
  const d = draft!;
  const o = original!;
  const nameIssue = tried ? nameProblem(d) : null;
  const update = (patch: Partial<Draft>) => setDraft({ ...d, ...patch });

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setTried(true);
    setSaveError(null);
    if (nameProblem(d)) {
      nameRef.current?.focus();
      return;
    }
    const picked = new FormData(e.currentTarget).get("colour");
    const changes = changesFrom(o, d);
    setSaving(true);
    try {
      if (Object.keys(changes).length) {
        const res = await fetch("/api/me", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(changes),
        });
        if (!res.ok) {
          setSaveError(saveErrorMessage(res.status, await res.json().catch(() => null)));
          return;
        }
      }
      if (isBadgeColour(picked)) writeBadgePrefs({ colour: picked });
      router.push(NEXT_STEP);
    } catch {
      setSaveError(saveErrorMessage(0, null));
    } finally {
      setSaving(false);
    }
  }

  const badge = (
    <Badge name={d.name.trim() || "Your name"} handle={person.githubLogin} nameFor={FIELD.name}>
      <BadgeRow field={FIELD.bio} caption="Bio">
        {d.bio.trim() ? (
          <span className="block text-sm leading-snug break-words">{d.bio.trim()}</span>
        ) : (
          <span className="block text-sm text-muted">+ Add a bio</span>
        )}
      </BadgeRow>
      <BadgeRow field={FIELD.skills} caption="Can help with">
        <span className="flex flex-wrap gap-1.5 pt-1">
          {d.languages.length ? (
            d.languages.map((l) => (
              <BadgeChip key={l} className="bg-accent/20">
                {l}
              </BadgeChip>
            ))
          ) : (
            <span className="text-sm text-muted">+ Add skills</span>
          )}
        </span>
      </BadgeRow>
      <BadgeRow field={FIELD.orgs} caption="Part of">
        <span className="flex flex-wrap gap-1.5 pt-1">
          {d.organisations.length ? (
            d.organisations.map((o) => <BadgeChip key={o}>{o}</BadgeChip>)
          ) : (
            <span className="text-sm text-muted">+ Add organisations</span>
          )}
        </span>
      </BadgeRow>
    </Badge>
  );

  return (
    <form
      onSubmit={submit}
      noValidate
      className={`grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:gap-16 ${colourFollowsPicker}`}
    >
      <div className="flex flex-col">
        <h1 className={headingClass}>Here&apos;s what we learned</h1>
        <p className="mt-3 max-w-md text-lg text-muted">From your public GitHub. Change anything before you go on.</p>

        <div className="mt-8 flex flex-col gap-9">
          <div className="flex flex-col gap-2">
            <label htmlFor={FIELD.name} className="text-xl font-bold leading-snug tracking-tight">
              Name
            </label>
            <input
              ref={nameRef}
              id={FIELD.name}
              type="text"
              value={d.name}
              maxLength={LIMITS.name + 20}
              autoComplete="name"
              aria-invalid={nameIssue ? true : undefined}
              aria-describedby={nameIssue ? "profile-name-problem" : undefined}
              onChange={(e) => update({ name: e.target.value })}
              className={`min-h-14 ${inputClass}`}
            />
            {nameIssue && (
              <p id="profile-name-problem" className={errorClass}>
                {nameIssue}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor={FIELD.bio} className="text-xl font-bold leading-snug tracking-tight">
              Bio
            </label>
            <textarea
              id={FIELD.bio}
              rows={3}
              value={d.bio}
              maxLength={LIMITS.bio}
              placeholder="What you work on, in a sentence or two"
              aria-describedby="profile-bio-count"
              onChange={(e) => update({ bio: e.target.value })}
              className={`py-3 leading-snug ${inputClass}`}
            />
            <p id="profile-bio-count" className="self-end text-sm text-muted">
              {d.bio.length} of {LIMITS.bio}
            </p>
          </div>

          <ChipEditor
            id={FIELD.skills}
            legend="Can help with"
            hint="From your repositories' languages. Add what people can ask you about."
            values={d.languages}
            onChange={(languages) => update({ languages })}
            placeholder="e.g. Kubernetes"
            addLabel="Add a skill"
            empty="Nothing imported yet. Add what you can help with."
          />

          <ChipEditor
            id={FIELD.orgs}
            legend="Part of"
            hint="Organisations and projects you belong to."
            values={d.organisations}
            onChange={(organisations) => update({ organisations })}
            placeholder="e.g. cncf"
            addLabel="Add an organisation"
            empty="None imported. Add projects you belong to."
          />

          <ColourPicker defaultColour={colour} />
        </div>

        <div className="mt-8 lg:hidden">{badge}</div>

        <div className="sticky bottom-0 -mx-4 mt-8 bg-background/95 px-4 pb-4 pt-3 backdrop-blur sm:static sm:mx-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
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
            {saving ? "Saving…" : "Save and continue"}
          </Button>
        </div>
      </div>

      {/* Laptop: the badge stays in view while you edit further down. */}
      <div className="hidden lg:block">
        <div className="lg:sticky lg:top-6">{badge}</div>
      </div>
    </form>
  );
}
